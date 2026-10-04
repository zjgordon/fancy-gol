/**
 * P3-D-4 — performance certification across themes.
 *
 * What this file measures, and what it deliberately does not claim:
 *
 * **It measures cost, not frame rate.** Every theme's quality-3 effect stack is driven through
 * the real layered compositor at 1920×1080 with ~100k visible cells (identical viewport and
 * soup to `render.bench.ts`, P0-I-4), and the case value is the sum of each pass's *measured*
 * EWMA — `EffectRegistry.totalDeclaredCost()`, the very number the degrade governor feeds on.
 * That is the theme's own CPU cost at the acceptance viewport, and it is the figure that was
 * missing when P3-A-5 declared costs and found them plausible.
 *
 * **It cannot measure frame rate here, and does not pretend to.** A Node harness has two
 * options and both misreport:
 *  - The `CanvasRecorder` path every other browser-class case uses records draw *dispatch*, not
 *    pixels. Measured at 6.9 ms/frame for a 512² soup — but the post-process passes read pixels
 *    with `getImageData`, so against a recorder-backed layer they iterate a blank frame. Cheap
 *    for the wrong reason.
 *  - The hand-written software canvas gives passes real pixels and a floor of **44.8 ms** per
 *    frame for a theme with *zero* effects, because four 1080p blits, two layer clears and a
 *    background fill are rasterised in JS where a browser uses the GPU. Wrong by ~6×.
 * So the frame-rate criteria (≥ 55 fps at q3, ≥ 60 fps at q0 under 4× throttle) are certified in
 * a real browser by `tests/perf/themes-fps.spec.ts` (Playwright project `browser-bench`) and
 * accumulate as `gate-history: browser-bench` — see `planning/README.md` §3.10 and ADR-011.
 * What lands here is the honest CPU record, gated on its real budgets.
 *
 * **The measured numbers, on the machine that recorded them (2026-10-04):**
 *
 * | theme | q3 stack cost | declared | 18.18 ms budget |
 * |---|---:|---:|---|
 * | default | 0.0 ms | 0.0 | holds |
 * | sids-place | 12.4 ms | 0.2 | holds |
 * | flatline | 37.6 ms | 3.9 | 2.1× over |
 * | void-walker | 79.5 ms | 4.6 | 4.4× over |
 * | synthwave | 103.7 ms | 5.1 | 5.7× over |
 * | chiba-city | 127.9 ms | 7.6 | 7.0× over |
 *
 * Post-processing on Canvas2D is main-thread work — `getImageData`, a JS loop over 2.07 M
 * texels, `putImageData` — and that is exactly the work a browser also does on the main thread.
 * Five of six themes therefore cannot hold 55 fps at 1080p until post moves to the GPU. The
 * budgets below are the acceptance criteria's, unsoftened; the rows that fail are the finding,
 * not a mistake in the harness.
 */
import type { EffectPass } from '../../src/render/effects/pass.ts';
import {
  QUALITY3_FRAME_BUDGET_MS,
  createChibaCityPassStack,
  createFlatlinePassStack,
  createSidsPlacePassStack,
  createSynthwavePassStack,
  createVoidWalkerPassStack,
  type ThemeId,
} from '../../src/render/effects/library.ts';
import { createSoftwareCanvas } from '../../src/render/effects/software-surface.ts';
import { Compositor } from '../../src/render/compositor.ts';
import { Canvas2DRenderer } from '../../src/render/canvas2d.ts';
import { CanvasRecorder } from '../../src/render/recorder.ts';
import { CHIBA_CITY_THEME } from '../../src/themes/chiba-city/theme.ts';
import { DEFAULT_DARK_THEME } from '../../src/themes/default/theme.ts';
import { FLATLINE_THEME } from '../../src/themes/flatline/theme.ts';
import { SIDS_PLACE_THEME } from '../../src/themes/sids-place/theme.ts';
import { SYNTHWAVE_THEME } from '../../src/themes/synthwave/theme.ts';
import { VOID_WALKER_THEME } from '../../src/themes/void-walker/theme.ts';
import { compileTheme } from '../../src/themes/registry.ts';
import type { ThemeModule } from '../../src/themes/types.ts';
import type { CompiledTheme, Viewport } from '../../src/render/types.ts';
import { soup } from './helpers.ts';
import type { BenchCase } from './types.ts';

const WIDTH = 1920;
const HEIGHT = 1080;
/** ~100k visible cells in a 1080p viewport — identical to `render.bench.ts` (P0-I-4). */
const CELL_SIZE = 4.55;
/** 60 fps budget (ms) — PHASE_3 §4's quality-0 row. */
const QUALITY0_FRAME_BUDGET_MS = 1000 / 60;
/**
 * Synthetic 4× CPU throttle — the technique P3-A-4 established in
 * `tests/unit/render/quality-governor.spec.ts`: a CPU-slowdown profile divides main-thread cost
 * by its factor, so a 4× profile is modelled by inflating the measured cost by 4. Labelled
 * synthetic: it proves the headroom the ladder leaves, it is not a hardware profile capture.
 */
const SYNTHETIC_THROTTLE_FACTOR = 4;

const VIEWPORT: Viewport = {
  originX: 0,
  originY: 0,
  cellSize: CELL_SIZE,
  widthPx: WIDTH,
  heightPx: HEIGHT,
  dpr: 1,
};

interface ThemeUnderTest {
  readonly id: ThemeId;
  readonly module: ThemeModule;
  /** The real pass stack, as `client/main.ts` installs it on activation. */
  readonly stack: () => EffectPass[];
  /** Age buffer on when the theme's palette/age ramp needs it (the client's own wiring). */
  readonly ageBuffer: boolean;
}

/** The registered themes, in registration order — the same six `main.ts` registers. */
const THEMES: readonly ThemeUnderTest[] = [
  { id: 'default', module: DEFAULT_DARK_THEME, stack: () => [], ageBuffer: false },
  { id: 'chiba-city', module: CHIBA_CITY_THEME, stack: createChibaCityPassStack, ageBuffer: true },
  { id: 'flatline', module: FLATLINE_THEME, stack: createFlatlinePassStack, ageBuffer: true },
  { id: 'sids-place', module: SIDS_PLACE_THEME, stack: createSidsPlacePassStack, ageBuffer: true },
  { id: 'void-walker', module: VOID_WALKER_THEME, stack: createVoidWalkerPassStack, ageBuffer: true },
  { id: 'synthwave', module: SYNTHWAVE_THEME, stack: createSynthwavePassStack, ageBuffer: true },
];

function medianOf(samples: readonly number[]): number {
  const sorted = [...samples].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A ~100k-cell viewport world: 512² toroidal soup, stepped 16 generations (as `render.bench.ts`). */
function populatedWorld(ageBuffer: boolean) {
  const world = soup(512, 512, 0.5);
  world.setAgeBuffer(ageBuffer);
  for (let i = 0; i < 16; i++) world.step();
  return world;
}

/**
 * Quality-3 stack cost: the theme's own passes, rendered for real at 1080p over the software
 * canvas, then read back through the governor's own accounting.
 */
class StackCostProbe {
  private constructor(
    private readonly compositor: Compositor,
    private readonly world: ReturnType<typeof populatedWorld>,
  ) {}

  static async open(theme: ThemeUnderTest): Promise<StackCostProbe> {
    const compositor = new Compositor({
      canvasFactory: (w, h) => createSoftwareCanvas(w, h) as unknown as HTMLCanvasElement,
    });
    await compositor.init(createSoftwareCanvas(WIDTH, HEIGHT) as unknown as HTMLCanvasElement);
    compositor.resize(WIDTH, HEIGHT, 1);
    compositor.setTheme(compileTheme(theme.module));
    compositor.setViewport(VIEWPORT);
    compositor.setEffectQuality(3);
    compositor.setEffectPasses(theme.stack());
    return new StackCostProbe(compositor, populatedWorld(theme.ageBuffer));
  }

  /** Warm `warm` frames, then median `n` measured stacks (ms). */
  measure(n: number, warm = 4): number {
    const samples: number[] = [];
    for (let i = 0; i < n + warm; i++) {
      this.compositor.draw({ cells: this.world.view(), dirty: null, tick: this.world.tick });
      if (i >= warm) samples.push(this.compositor.effectRegistry.totalDeclaredCost());
    }
    return medianOf(samples);
  }

  dispose(): void {
    this.compositor.dispose();
  }
}

/**
 * Quality-0 frame cost on the established `CanvasRecorder` path — the same harness
 * `render-frame-cpu`, `default-theme-render-frame` and `pan-1000pxs-1080p` use, so the number
 * is comparable to every other browser-class case in the suite. Quality 0 runs no passes at all
 * (`stagesForQuality(0)` is empty), which is the point: what is left is the theme's palette and
 * the cell layer, i.e. the cost the ladder cannot reduce any further.
 */
class Quality0Probe {
  private constructor(
    private readonly renderer: Canvas2DRenderer,
    private readonly recorder: CanvasRecorder,
    private readonly world: ReturnType<typeof populatedWorld>,
  ) {}

  static async open(theme: ThemeUnderTest): Promise<Quality0Probe> {
    const recorder = new CanvasRecorder(WIDTH, HEIGHT);
    const canvas = {
      width: 0,
      height: 0,
      style: {} as { width?: string; height?: string },
      getContext: (kind: string) => (kind === '2d' ? recorder : null),
    } as unknown as HTMLCanvasElement;
    const renderer = new Canvas2DRenderer();
    await renderer.init(canvas);
    renderer.resize(WIDTH, HEIGHT, 1);
    const compiled: CompiledTheme = compileTheme(theme.module);
    renderer.setTheme(compiled);
    renderer.setViewport(VIEWPORT);
    return new Quality0Probe(renderer, recorder, populatedWorld(theme.ageBuffer));
  }

  /** Median frame time (ms), then × the synthetic throttle factor. */
  measureThrottled(n: number, warm = 4): number {
    const samples: number[] = [];
    for (let i = 0; i < n + warm; i++) {
      this.recorder.resetLog();
      this.renderer.draw({ cells: this.world.view(), dirty: null, tick: this.world.tick });
      if (i >= warm) samples.push(this.renderer.readStats().frameMs * SYNTHETIC_THROTTLE_FACTOR);
    }
    return medianOf(samples);
  }

  dispose(): void {
    this.renderer.dispose();
  }
}

let stackProbe: StackCostProbe | undefined;
let quality0Probe: Quality0Probe | undefined;
/** Filled by `theme-heaviest-stack-cost`'s setup: the worst theme's measured stack cost. */
let heaviestStackCost = 0;

export const cases: BenchCase[] = [
  ...THEMES.map<BenchCase>((theme) => ({
    id: `theme-${theme.id}-q3-stack-cost`,
    name: `${theme.module.name} quality 3 — measured CPU cost of its own effect stack at 1080p / 100k visible cells (pass EWMA sum = the governor's input)`,
    unit: 'ms',
    budget: QUALITY3_FRAME_BUDGET_MS,
    higherIsBetter: false,
    class: 'browser',
    warmup: 4,
    async setup() {
      stackProbe?.dispose();
      stackProbe = await StackCostProbe.open(theme);
    },
    run() {
      return stackProbe!.measure(5);
    },
    teardown() {
      stackProbe?.dispose();
      stackProbe = undefined;
    },
  })),
  {
    id: 'theme-heaviest-stack-cost',
    name: 'heaviest of the six themes — measured quality-3 stack cost at 1080p (the number PHASE_3 §4 gates on)',
    unit: 'ms',
    budget: QUALITY3_FRAME_BUDGET_MS,
    higherIsBetter: false,
    class: 'browser',
    warmup: 2,
    async setup() {
      stackProbe?.dispose();
      // Open every theme in turn, measure each, keep the worst — the gate is about the worst.
      const probes: StackCostProbe[] = [];
      let heaviest = 0;
      for (const theme of THEMES) {
        const probe = await StackCostProbe.open(theme);
        heaviest = Math.max(heaviest, probe.measure(3, 2));
        probes.push(probe);
      }
      for (const probe of probes) probe.dispose();
      heaviestStackCost = heaviest;
    },
    run() {
      if (heaviestStackCost <= 0) throw new Error('unreachable: setup measured every theme');
      return heaviestStackCost;
    },
  },
  ...THEMES.map<BenchCase>((theme) => ({
    id: `theme-${theme.id}-q0-throttled-frame`,
    name: `${theme.module.name} quality 0 — 1080p / 100k visible cells frame time under a synthetic 4× CPU throttle (CanvasRecorder CPU path; the browser's GPU composite is not represented)`,
    unit: 'ms',
    budget: QUALITY0_FRAME_BUDGET_MS,
    higherIsBetter: false,
    class: 'browser',
    warmup: 4,
    async setup() {
      quality0Probe?.dispose();
      quality0Probe = await Quality0Probe.open(theme);
    },
    run() {
      return quality0Probe!.measureThrottled(5);
    },
    teardown() {
      quality0Probe?.dispose();
      quality0Probe = undefined;
    },
  })),
];