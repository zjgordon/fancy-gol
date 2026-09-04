/**
 * P1-D-3 — the status bar: generation, population, per-state counts as auto-generated chips,
 * cursor world coordinates, the cell state under the cursor, zoom %, fps, step ms, render ms,
 * and a labelled memory estimate. A pure DOM + `update()` component, the same "caller pushes,
 * component doesn't own a subscription" shape `transport.ts`/`speed.ts` (P1-D-2) already use —
 * `client/main.ts` is the one that knows the real numbers (frame stats, the camera, the pointer,
 * the renderer's own timing) and decides *when* to push them.
 *
 * "Numbers use tabular figures and are throttled to 10 Hz" is a caller discipline, not something
 * this module enforces itself: `update()` renders whatever it's given, whenever it's called —
 * `client/main.ts` is what only calls it once every 100 ms, decoupled from both the render loop
 * (which can run far faster) and from simulation frame delivery (which stops entirely while
 * paused, yet the cursor/zoom readouts must keep updating regardless).
 */

export interface StatusChip {
  readonly id: number;
  readonly name: string;
  readonly count: number;
  /** A representative swatch colour for this state — the caller's theme, not a literal here. */
  readonly color: string;
}

export interface CellUnderCursor {
  readonly id: number;
  readonly name: string;
}

export interface StatusBarState {
  readonly generation: number;
  readonly population: number;
  readonly chips: readonly StatusChip[];
  /** World coordinates (already snapped to the cell they'd paint), or `null` off-canvas. */
  readonly cursor: { readonly x: number; readonly y: number } | null;
  readonly cellUnderCursor: CellUnderCursor | null;
  readonly zoomPercent: number;
  readonly fps: number;
  readonly stepMs: number;
  readonly renderMs: number;
  /** A labelled estimate, never presented as exact — see `formatBytes`'s "~" prefix. */
  readonly memoryBytes: number;
}

/** The documented "10 Hz, not 60 Hz" cadence — a caller discipline (see module doc), exported so
 * `client/main.ts`'s own throttle timer and this module's stated rationale can't drift apart. */
export const STATUS_THROTTLE_MS = 100;

export interface StatusBar {
  readonly root: HTMLElement;
  update(state: StatusBarState): void;
  dispose(): void;
}

/** `cellSize` (CSS px/cell) at which zoom reads 100% — `ui/camera.ts`'s own default `cellSize`,
 * i.e. "however a fresh `Camera` starts" is the 100% reference. Provisional, like every other
 * bare convention this phase ships ahead of a real "fit to content" affordance defining one. */
const REFERENCE_CELL_SIZE_PX = 16;

export function zoomPercent(cellSizePx: number): number {
  return (cellSizePx / REFERENCE_CELL_SIZE_PX) * 100;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `~${bytes} B`;
  if (bytes < 1024 * 1024) return `~${(bytes / 1024).toFixed(1)} KB`;
  return `~${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatMs(ms: number): string {
  return `${ms.toFixed(2)} ms`;
}

function row(label: string): { readonly el: HTMLElement; readonly value: HTMLElement } {
  const el = document.createElement('div');
  el.className = 'row';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const value = document.createElement('span');
  value.className = 'status-value';
  el.append(labelEl, value);
  return { el, value };
}

export function createStatusBar(): StatusBar {
  const root = document.createElement('div');
  root.className = 'chrome-panel status-bar';

  const generation = row('gen');
  const population = row('pop');
  const cursor = row('cursor');
  const cell = row('cell');
  const zoom = row('zoom');
  const fps = row('fps');
  const step = row('step');
  const render = row('render');
  const memory = row('mem');

  const chipsRow = document.createElement('div');
  chipsRow.className = 'status-chips';

  root.append(
    generation.el,
    population.el,
    chipsRow,
    cursor.el,
    cell.el,
    zoom.el,
    fps.el,
    step.el,
    render.el,
    memory.el,
  );

  const chipEls = new Map<number, { readonly el: HTMLElement; readonly count: HTMLElement }>();

  function syncChips(chips: readonly StatusChip[]): void {
    const seen = new Set<number>();
    for (const chip of chips) {
      seen.add(chip.id);
      let entry = chipEls.get(chip.id);
      if (!entry) {
        const el = document.createElement('span');
        el.className = 'status-chip';
        const swatch = document.createElement('span');
        swatch.className = 'status-chip-swatch';
        const name = document.createElement('span');
        name.className = 'status-chip-name';
        name.textContent = chip.name;
        const count = document.createElement('span');
        count.className = 'status-value';
        el.append(swatch, name, count);
        chipsRow.appendChild(el);
        entry = { el, count };
        chipEls.set(chip.id, entry);
      }
      entry.el.style.setProperty('--gol-chip-color', chip.color);
      entry.count.textContent = String(chip.count);
    }
    // A ruleset switch (P1-D-4) can shrink the state set — drop chips for ids no longer present
    // rather than leave a stale swatch behind.
    for (const [id, entry] of chipEls) {
      if (!seen.has(id)) {
        entry.el.remove();
        chipEls.delete(id);
      }
    }
  }

  function update(state: StatusBarState): void {
    generation.value.textContent = String(state.generation);
    population.value.textContent = String(state.population);
    syncChips(state.chips);
    cursor.value.textContent = state.cursor ? `${state.cursor.x}, ${state.cursor.y}` : '—';
    cell.value.textContent = state.cellUnderCursor ? state.cellUnderCursor.name : '—';
    zoom.value.textContent = `${state.zoomPercent.toFixed(0)}%`;
    fps.value.textContent = state.fps.toFixed(0);
    step.value.textContent = formatMs(state.stepMs);
    render.value.textContent = formatMs(state.renderMs);
    memory.value.textContent = formatBytes(state.memoryBytes);
  }

  return {
    root,
    update,
    dispose(): void {
      // No external (window/document) listeners are attached — every listener here is on an
      // element `root` owns, so removing `root` from the DOM is all disposal ever needs.
    },
  };
}
