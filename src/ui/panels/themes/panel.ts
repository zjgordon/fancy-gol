/**
 * Theme picker panel (P3-D-1). Live preview canvases are created here; the
 * composition root owns Simulation/renderer pairs via `ThemePreviewLoop`.
 */
import type { ThemeModule } from '@themes/types';
import type { PanelSpec } from '@ui/shell/panel-host';

export const THEMES_PANEL_ID = 'themes';
export const THEMES_PANEL_MIN_WIDTH = 280;

export interface ThemeCardInfo {
  readonly id: string;
  readonly name: string;
  readonly cost: ThemeModule['cost'];
}

export interface ThemesPanelOptions {
  readonly themes: readonly ThemeCardInfo[];
  readonly activeId: string;
  readonly onSelect: (id: string) => void;
  readonly onPreviewCreated?: (id: string, canvas: HTMLCanvasElement) => void;
  readonly onOpen?: () => void;
  readonly onClose?: () => void;
}

export interface ThemesPanel {
  readonly spec: PanelSpec;
  readonly root: HTMLElement;
  setActive(id: string): void;
  getActive(): string;
  dispose(): void;
}

const COST_LABEL: Record<ThemeModule['cost'], string> = {
  low: 'light',
  medium: 'medium',
  high: 'rich',
};

export function createThemesPanel(opts: ThemesPanelOptions): ThemesPanel {
  let activeId = opts.activeId;

  const root = document.createElement('div');
  root.className = 'themes-panel';

  const intro = document.createElement('p');
  intro.className = 'themes-intro';
  intro.textContent = 'Pick a look. Each card runs a tiny live preview.';
  root.appendChild(intro);

  const grid = document.createElement('div');
  grid.className = 'themes-grid';
  grid.setAttribute('role', 'listbox');
  grid.setAttribute('aria-label', 'Themes');
  root.appendChild(grid);

  const cards = new Map<string, HTMLButtonElement>();

  function syncPressed(): void {
    for (const [id, btn] of cards) {
      btn.setAttribute('aria-selected', id === activeId ? 'true' : 'false');
      btn.classList.toggle('themes-card--active', id === activeId);
    }
  }

  for (const theme of opts.themes) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'themes-card';
    btn.setAttribute('role', 'option');
    btn.setAttribute('aria-label', `${theme.name} theme`);
    btn.dataset['themeId'] = theme.id;

    const canvas = document.createElement('canvas');
    canvas.className = 'themes-preview';
    canvas.width = 48;
    canvas.height = 48;
    canvas.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'themes-card-body';
    const name = document.createElement('span');
    name.className = 'themes-card-name';
    name.textContent = theme.name;
    const cost = document.createElement('span');
    cost.className = 'themes-card-cost';
    cost.textContent = COST_LABEL[theme.cost];
    body.append(name, cost);

    btn.append(canvas, body);
    btn.addEventListener('click', () => {
      if (theme.id === activeId) return;
      opts.onSelect(theme.id);
    });

    grid.appendChild(btn);
    cards.set(theme.id, btn);
    opts.onPreviewCreated?.(theme.id, canvas);
  }

  syncPressed();

  const spec: PanelSpec = {
    id: THEMES_PANEL_ID,
    title: 'Themes',
    minWidthPx: THEMES_PANEL_MIN_WIDTH,
    mount(body) {
      body.appendChild(root);
      opts.onOpen?.();
    },
    unmount() {
      root.remove();
      opts.onClose?.();
    },
  };

  return {
    spec,
    root,
    setActive(id) {
      activeId = id;
      syncPressed();
    },
    getActive() {
      return activeId;
    },
    dispose() {
      root.remove();
      cards.clear();
    },
  };
}
