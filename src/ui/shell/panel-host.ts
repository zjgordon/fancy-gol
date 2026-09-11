/**
 * One dock for library, statistics, and the ruleset studio (P2-G-2). Consumers only register;
 * they do not invent a second layout, focus, or session contract.
 *
 * Focus trap and Escape match `dialog.ts`: capture-phase Tab wrap, Escape collapses then closes,
 * focus returns to whatever had it. Width never goes below the active panel's declared minimum.
 */
import {
  DEFAULT_PANEL_LAYOUT,
  type PanelDockSide,
  type SessionPanelLayout,
} from '@shared/session';

export interface PanelSpec {
  readonly id: string;
  readonly title: string;
  /** Smallest width the panel's controls remain usable. The host clamps resize to this. */
  readonly minWidthPx: number;
  mount(body: HTMLElement): void;
  unmount?(body: HTMLElement): void;
}

export interface PanelHostKeySurface {
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void, options?: boolean): void;
  removeEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void, options?: boolean): void;
}

export interface PanelHostOptions {
  readonly mount: HTMLElement;
  readonly keyTarget?: PanelHostKeySurface;
  readonly layout?: SessionPanelLayout;
  readonly onLayoutChange?: (layout: SessionPanelLayout) => void;
  readonly getViewportWidth?: () => number;
}

export interface PanelHost {
  readonly root: HTMLElement;
  register(spec: PanelSpec): void;
  unregister(id: string): void;
  open(id: string): void;
  close(): void;
  setCollapsed(collapsed: boolean): void;
  setDock(dock: PanelDockSide): void;
  setWidth(widthPx: number): void;
  getLayout(): SessionPanelLayout;
  applyLayout(layout: SessionPanelLayout): void;
  dispose(): void;
}

function focusableElements(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>('button, [href], input, select, textarea, [tabindex]')].filter(
    (el) => !el.hasAttribute('disabled') && el.tabIndex !== -1,
  );
}

export function clampPanelWidth(widthPx: number, minWidthPx: number, viewportWidthPx: number): number {
  const maxWidth = Math.max(minWidthPx, Math.floor(viewportWidthPx * 0.8));
  return Math.min(maxWidth, Math.max(minWidthPx, widthPx));
}

export function attachPanelHost(options: PanelHostOptions): PanelHost {
  const specs = new Map<string, PanelSpec>();
  let layout: SessionPanelLayout = { ...(options.layout ?? DEFAULT_PANEL_LAYOUT) };
  let previouslyFocused: HTMLElement | null = null;
  let dragging = false;
  let dragStartX = 0;
  let dragStartWidth = 0;

  const root = document.createElement('div');
  root.className = 'panel-host chrome-panel';
  root.setAttribute('role', 'complementary');
  root.setAttribute('aria-label', 'Panels');
  root.tabIndex = -1;

  const rail = document.createElement('div');
  rail.className = 'panel-host-rail';

  const tabs = document.createElement('div');
  tabs.className = 'panel-host-tabs';
  tabs.setAttribute('role', 'tablist');
  tabs.setAttribute('aria-label', 'Open panel');

  const collapseBtn = document.createElement('button');
  collapseBtn.type = 'button';
  collapseBtn.className = 'panel-host-collapse';
  collapseBtn.textContent = 'Collapse';

  const dockBtn = document.createElement('button');
  dockBtn.type = 'button';
  dockBtn.className = 'panel-host-dock';
  dockBtn.textContent = 'Dock left';

  rail.append(tabs, collapseBtn, dockBtn);

  const frame = document.createElement('div');
  frame.className = 'panel-host-frame';

  const handle = document.createElement('div');
  handle.className = 'panel-host-resize';
  handle.setAttribute('role', 'separator');
  handle.setAttribute('aria-orientation', 'vertical');
  handle.setAttribute('aria-label', 'Resize panels');
  handle.tabIndex = 0;

  const panel = document.createElement('div');
  panel.className = 'panel-host-panel';
  panel.setAttribute('role', 'tabpanel');
  panel.tabIndex = -1;

  const titleEl = document.createElement('h2');
  titleEl.className = 'panel-host-title';
  titleEl.id = 'panel-host-title';
  panel.setAttribute('aria-labelledby', titleEl.id);

  const body = document.createElement('div');
  body.className = 'panel-host-body';
  panel.append(titleEl, body);
  frame.append(handle, panel);
  root.append(rail, frame);

  const keyTarget: PanelHostKeySurface | undefined =
    options.keyTarget ?? (typeof document !== 'undefined' ? document : undefined);
  const getViewportWidth = options.getViewportWidth ?? (() => (typeof window !== 'undefined' ? window.innerWidth : 1280));

  function minWidth(): number {
    const spec = layout.activeId ? specs.get(layout.activeId) : undefined;
    return spec?.minWidthPx ?? DEFAULT_PANEL_LAYOUT.widthPx;
  }

  function emit(): void {
    options.onLayoutChange?.(layout);
  }

  function unmountActive(): void {
    const spec = layout.activeId ? specs.get(layout.activeId) : undefined;
    spec?.unmount?.(body);
    body.replaceChildren();
  }

  function mountActive(): void {
    body.replaceChildren();
    const spec = layout.activeId ? specs.get(layout.activeId) : undefined;
    if (!spec) {
      titleEl.textContent = '';
      return;
    }
    titleEl.textContent = spec.title;
    spec.mount(body);
  }

  function sync(): void {
    const hasPanels = specs.size > 0;
    if (hasPanels && root.parentNode !== options.mount) options.mount.appendChild(root);
    if (!hasPanels) {
      root.remove();
      return;
    }

    root.dataset['dock'] = layout.dock;
    root.dataset['collapsed'] = layout.collapsed ? 'true' : 'false';
    root.classList.toggle('panel-host-collapsed', layout.collapsed);
    options.mount.dataset['dock'] = layout.dock;
    const width = clampPanelWidth(layout.widthPx, minWidth(), getViewportWidth());
    if (width !== layout.widthPx) layout = { ...layout, widthPx: width };
    root.style.setProperty('--gol-panel-width', `${width}px`);
    root.style.setProperty('--gol-panel-min-width', `${minWidth()}px`);

    handle.setAttribute('aria-valuemin', String(minWidth()));
    handle.setAttribute('aria-valuemax', String(Math.floor(getViewportWidth() * 0.8)));
    handle.setAttribute('aria-valuenow', String(width));

    collapseBtn.textContent = layout.collapsed ? 'Expand' : 'Collapse';
    collapseBtn.setAttribute('aria-expanded', layout.collapsed ? 'false' : 'true');
    dockBtn.textContent = layout.dock === 'right' ? 'Dock left' : 'Dock right';
    frame.hidden = layout.collapsed || layout.activeId === null;

    for (const btn of tabs.querySelectorAll<HTMLButtonElement>('button[data-panel-id]')) {
      const selected = btn.dataset['panelId'] === layout.activeId;
      btn.setAttribute('aria-selected', selected ? 'true' : 'false');
      btn.tabIndex = selected ? 0 : -1;
    }
  }

  function rebuildTabs(): void {
    tabs.replaceChildren();
    for (const spec of specs.values()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset['panelId'] = spec.id;
      btn.setAttribute('role', 'tab');
      btn.id = `panel-tab-${spec.id}`;
      btn.setAttribute('aria-controls', panel.id);
      btn.textContent = spec.title;
      btn.addEventListener('click', () => {
        open(spec.id);
      });
      tabs.appendChild(btn);
    }
    if (!panel.id) panel.id = 'panel-host-tabpanel';
    sync();
  }

  function rememberFocus(): void {
    const active = document.activeElement;
    if (active instanceof HTMLElement && !root.contains(active)) previouslyFocused = active;
  }

  function restoreFocus(): void {
    previouslyFocused?.focus();
  }

  function open(id: string): void {
    if (!specs.has(id)) return;
    rememberFocus();
    if (layout.activeId !== id) {
      unmountActive();
      layout = { ...layout, activeId: id, collapsed: false };
      mountActive();
    } else {
      layout = { ...layout, collapsed: false };
    }
    sync();
    panel.focus();
    emit();
  }

  function close(): void {
    unmountActive();
    layout = { ...layout, activeId: null };
    sync();
    restoreFocus();
    emit();
  }

  function setCollapsed(collapsed: boolean): void {
    if (layout.collapsed === collapsed) return;
    if (collapsed) rememberFocus();
    layout = { ...layout, collapsed };
    sync();
    if (collapsed) restoreFocus();
    else panel.focus();
    emit();
  }

  function setDock(dock: PanelDockSide): void {
    if (layout.dock === dock) return;
    layout = { ...layout, dock };
    sync();
    emit();
  }

  function setWidth(widthPx: number): void {
    const next = clampPanelWidth(widthPx, minWidth(), getViewportWidth());
    if (next === layout.widthPx) return;
    layout = { ...layout, widthPx: next };
    sync();
    emit();
  }

  function applyLayout(next: SessionPanelLayout): void {
    if (layout.activeId && layout.activeId !== next.activeId) unmountActive();
    layout = { ...next };
    if (layout.activeId && specs.has(layout.activeId)) mountActive();
    else if (layout.activeId && !specs.has(layout.activeId)) layout = { ...layout, activeId: null };
    sync();
  }

  collapseBtn.addEventListener('click', () => {
    setCollapsed(!layout.collapsed);
  });
  dockBtn.addEventListener('click', () => {
    setDock(layout.dock === 'right' ? 'left' : 'right');
  });

  handle.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    dragging = true;
    dragStartX = e.clientX;
    dragStartWidth = layout.widthPx;
    handle.setPointerCapture?.(e.pointerId);
  });
  handle.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const delta = layout.dock === 'right' ? dragStartX - e.clientX : e.clientX - dragStartX;
    setWidth(dragStartWidth + delta);
  });
  handle.addEventListener('pointerup', () => {
    dragging = false;
  });
  handle.addEventListener('pointercancel', () => {
    dragging = false;
  });
  handle.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    e.preventDefault();
    const towardInward = layout.dock === 'right' ? e.key === 'ArrowLeft' : e.key === 'ArrowRight';
    setWidth(layout.widthPx + (towardInward ? 16 : -16));
  });

  function onKeyDown(e: KeyboardEvent): void {
    const target = e.target;
    if (!(target instanceof Node) || !root.contains(target)) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      if (!layout.collapsed && layout.activeId) setCollapsed(true);
      else close();
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = focusableElements(root);
    if (focusable.length === 0) {
      e.preventDefault();
      root.focus();
      return;
    }
    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
  keyTarget?.addEventListener('keydown', onKeyDown, true);

  return {
    root,
    register(spec) {
      specs.set(spec.id, spec);
      rebuildTabs();
      if (layout.activeId === spec.id) mountActive();
    },
    unregister(id) {
      if (layout.activeId === id) close();
      specs.delete(id);
      rebuildTabs();
    },
    open,
    close,
    setCollapsed,
    setDock,
    setWidth,
    getLayout: () => layout,
    applyLayout,
    dispose() {
      unmountActive();
      keyTarget?.removeEventListener('keydown', onKeyDown, true);
      root.remove();
    },
  };
}
