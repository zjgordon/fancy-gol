/**
 * P1-H-1 — the inspect surface `?test=1` publishes on `window.__fancyGol`, plus the flag parser
 * the composition root uses to freeze the run (seeded PRNG, paused sim, no intro, no inertia).
 *
 * Kept in its own file so Playwright specs can import the type without pulling `main.ts` (which
 * boots the whole app). The object itself is assembled in `main.ts`; this is only the contract.
 */

export function isTestMode(search: string = typeof window === 'undefined' ? '' : window.location.search): boolean {
  return new URLSearchParams(search).get('test') === '1';
}

export interface FancyGolHarness {
  readonly ready: boolean;
  readonly tick: number;
  readonly population: number;
  readonly running: boolean;
  readonly targetTps: number;
  readonly cellSize: number;
  readonly originX: number;
  readonly originY: number;
  readonly widthPx: number;
  readonly heightPx: number;
  readonly activeToolId: string | null;
  readonly rulesetId: string;
  readonly themeId: string;
  readonly brushSize: number;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  readonly lastCommands: readonly string[];
  readonly liveState: string | null;
  readonly liveMessageCount: number;
  readonly lastShareUrl: string | null;
  getCell(x: number, y: number): number;
  worldToScreen(x: number, y: number): { px: number; py: number };
  screenToWorld(px: number, py: number): { x: number; y: number };
  /** Test-only camera pose. Omitted fields keep their current value. */
  setCamera(pose: { originX?: number; originY?: number; cellSize?: number }): void;
  /** Run a registered command by id (avoids browser-reserved shortcuts like Mod+S on WebKit). */
  runCommand(id: string): Promise<void> | void;
}

export interface HarnessSources {
  readonly ready: () => boolean;
  readonly tick: () => number;
  readonly population: () => number;
  readonly running: () => boolean;
  readonly targetTps: () => number;
  readonly cellSize: () => number;
  readonly originX: () => number;
  readonly originY: () => number;
  readonly widthPx: () => number;
  readonly heightPx: () => number;
  readonly activeToolId: () => string | null;
  readonly rulesetId: () => string;
  readonly themeId: () => string;
  readonly brushSize: () => number;
  readonly canUndo: () => boolean;
  readonly canRedo: () => boolean;
  readonly lastCommands: () => readonly string[];
  readonly liveState: () => string | null;
  readonly liveMessageCount: () => number;
  readonly lastShareUrl: () => string | null;
  readonly getCell: (x: number, y: number) => number;
  readonly worldToScreen: (x: number, y: number) => { px: number; py: number };
  readonly screenToWorld: (px: number, py: number) => { x: number; y: number };
  readonly setCamera: (pose: { originX?: number; originY?: number; cellSize?: number }) => void;
  readonly runCommand: (id: string) => Promise<void> | void;
}

/** Build the inspect object Playwright reads. Getters stay live against the composition root. */
export function createHarness(src: HarnessSources): FancyGolHarness {
  return {
    get ready() {
      return src.ready();
    },
    get tick() {
      return src.tick();
    },
    get population() {
      return src.population();
    },
    get running() {
      return src.running();
    },
    get targetTps() {
      return src.targetTps();
    },
    get cellSize() {
      return src.cellSize();
    },
    get originX() {
      return src.originX();
    },
    get originY() {
      return src.originY();
    },
    get widthPx() {
      return src.widthPx();
    },
    get heightPx() {
      return src.heightPx();
    },
    get activeToolId() {
      return src.activeToolId();
    },
    get rulesetId() {
      return src.rulesetId();
    },
    get themeId() {
      return src.themeId();
    },
    get brushSize() {
      return src.brushSize();
    },
    get canUndo() {
      return src.canUndo();
    },
    get canRedo() {
      return src.canRedo();
    },
    get lastCommands() {
      return src.lastCommands();
    },
    get liveState() {
      return src.liveState();
    },
    get liveMessageCount() {
      return src.liveMessageCount();
    },
    get lastShareUrl() {
      return src.lastShareUrl();
    },
    getCell: src.getCell,
    worldToScreen: src.worldToScreen,
    screenToWorld: src.screenToWorld,
    setCamera: src.setCamera,
    runCommand: src.runCommand,
  };
}
