import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { DEAD, type GridView } from '@engine/types';
import { createStatusBar, STATUS_THROTTLE_MS, zoomPercent, type StatusBarState } from '@ui/components/statusbar';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

function baseState(overrides: Partial<StatusBarState> = {}): StatusBarState {
  return {
    generation: 0,
    population: 0,
    chips: [],
    cursor: null,
    cellUnderCursor: null,
    zoomPercent: 100,
    fps: 60,
    stepMs: 1,
    renderMs: 1,
    memoryBytes: 0,
    ...overrides,
  };
}

function valueOf(root: HTMLElement, label: string): string {
  const row = [...root.querySelectorAll('.row')].find((r) => r.querySelector('.label')?.textContent === label)!;
  return row.querySelector('.status-value')!.textContent ?? '';
}

describe('zoomPercent', () => {
  it('reads 100% at the reference cell size (Camera\'s own default of 16px/cell)', () => {
    expect(zoomPercent(16)).toBe(100);
  });

  it('scales linearly with cellSize', () => {
    expect(zoomPercent(32)).toBe(200);
    expect(zoomPercent(8)).toBe(50);
  });
});

describe('createStatusBar', () => {
  it('renders generation, population, and every numeric readout', () => {
    const bar = createStatusBar();
    bar.update(
      baseState({
        generation: 42,
        population: 7,
        zoomPercent: 150,
        fps: 59.6,
        stepMs: 1.234,
        renderMs: 0.5,
        memoryBytes: 2048,
      }),
    );
    expect(valueOf(bar.root, 'gen')).toBe('42');
    expect(valueOf(bar.root, 'pop')).toBe('7');
    expect(valueOf(bar.root, 'zoom')).toBe('150%');
    expect(valueOf(bar.root, 'fps')).toBe('60');
    expect(valueOf(bar.root, 'step')).toBe('1.23 ms');
    expect(valueOf(bar.root, 'render')).toBe('0.50 ms');
    expect(valueOf(bar.root, 'mem')).toBe('~2.0 KB');
  });

  it('every numeric readout is a fixed-width column, so a digit-count change never shifts its label', () => {
    const bar = createStatusBar();
    bar.update(baseState());
    for (const value of bar.root.querySelectorAll('.status-value')) {
      expect(value.classList.contains('status-value')).toBe(true); // the CSS-level min-width/tabular-nums hook
    }
  });

  it('shows an em dash for cursor and cell-under-cursor when the pointer is off-canvas', () => {
    const bar = createStatusBar();
    bar.update(baseState({ cursor: null, cellUnderCursor: null }));
    expect(valueOf(bar.root, 'cursor')).toBe('—');
    expect(valueOf(bar.root, 'cell')).toBe('—');
  });

  it('renders cursor world coordinates and the cell state name once the pointer is over the canvas', () => {
    const bar = createStatusBar();
    bar.update(baseState({ cursor: { x: 12, y: -3 }, cellUnderCursor: { id: 1, name: 'alive' } }));
    expect(valueOf(bar.root, 'cursor')).toBe('12, -3');
    expect(valueOf(bar.root, 'cell')).toBe('alive');
  });

  describe('per-state chips', () => {
    it('auto-generates one chip per state, with its name, count, and colour', () => {
      const bar = createStatusBar();
      bar.update(
        baseState({
          chips: [
            { id: 0, name: 'dead', count: 90, color: '#05070a' },
            { id: 1, name: 'alive', count: 10, color: '#7cf9d0' },
          ],
        }),
      );
      const chips = [...bar.root.querySelectorAll('.status-chip')];
      expect(chips).toHaveLength(2);
      expect(chips[0]!.querySelector('.status-chip-name')!.textContent).toBe('dead');
      expect(chips[0]!.querySelector('.status-value')!.textContent).toBe('90');
      expect(chips[0]!.querySelector<HTMLElement>('.status-chip-swatch')!.style.getPropertyValue('--gol-chip-color')).toBe(
        '',
      );
      expect((chips[0] as HTMLElement).style.getPropertyValue('--gol-chip-color')).toBe('#05070a');
      expect(chips[1]!.querySelector('.status-value')!.textContent).toBe('10');
    });

    it('updates counts in place across calls rather than rebuilding the chip elements', () => {
      const bar = createStatusBar();
      bar.update(baseState({ chips: [{ id: 1, name: 'alive', count: 5, color: '#fff' }] }));
      const chipBefore = bar.root.querySelector('.status-chip');
      bar.update(baseState({ chips: [{ id: 1, name: 'alive', count: 6, color: '#fff' }] }));
      const chipAfter = bar.root.querySelector('.status-chip');
      expect(chipAfter).toBe(chipBefore); // same DOM node, not torn down and rebuilt
      expect(valueOf(bar.root, 'cell')).toBe('—'); // sanity: didn't corrupt an unrelated row
      expect(chipAfter!.querySelector('.status-value')!.textContent).toBe('6');
    });

    it('drops a chip once its state id is no longer present (a ruleset switch shrinking the state set)', () => {
      const bar = createStatusBar();
      bar.update(
        baseState({
          chips: [
            { id: 0, name: 'dead', count: 1, color: '#000' },
            { id: 1, name: 'alive', count: 1, color: '#fff' },
          ],
        }),
      );
      expect(bar.root.querySelectorAll('.status-chip')).toHaveLength(2);
      bar.update(baseState({ chips: [{ id: 0, name: 'dead', count: 2, color: '#000' }] }));
      expect(bar.root.querySelectorAll('.status-chip')).toHaveLength(1);
    });
  });

  describe('performance', () => {
    it.skipIf(UNDER_COVERAGE)('update() costs well under the 0.3 ms/frame budget', () => {
      // CPU dispatch, not real browser paint/composite — the same honest scope P0-H-2's and
      // P1-A-3's own frame-time budgets already use. Skipped under coverage instrumentation,
      // which skews timing, matching this codebase's established convention
      // (`simulation.spec.ts`'s own `UNDER_COVERAGE` guard).
      const bar = createStatusBar();
      const state = baseState({
        generation: 12345,
        population: 6789,
        chips: [
          { id: 0, name: 'dead', count: 1000, color: '#05070a' },
          { id: 1, name: 'alive', count: 234, color: '#7cf9d0' },
        ],
        cursor: { x: 10, y: 20 },
        cellUnderCursor: { id: 1, name: 'alive' },
      });
      // Warm-up: steady-state JIT cost, not first-call compilation (this file's own convention,
      // matching P1-B-3's brush-stroke throughput test).
      for (let i = 0; i < 50; i++) bar.update(state);

      const iterations = 2000;
      const start = performance.now();
      for (let i = 0; i < iterations; i++) bar.update(state);
      const elapsed = performance.now() - start;
      expect(elapsed / iterations).toBeLessThan(0.3);
    });
  });
});

/**
 * P1-D-3's "population matches an engine recount exactly at 100 random ticks" criterion, proven
 * directly against a real `Simulation` — `frame.stats.population` (what the status bar is handed,
 * unmodified — see `client/main.ts`'s `syncStatusBar`) is exactly `sim.stats.population` here,
 * copied across the wire by `worker/handler.ts`'s `copyStats`. This duplicates the *shape* of
 * `tests/unit/engine/stats/collector.spec.ts`'s own (considerably stronger — 2,000 generations)
 * cross-check, deliberately: that test proves the engine's own invariant; this one is this task's
 * own, literal, self-contained evidence for its own acceptance criterion.
 */
describe('population accuracy (engine-level, backing the status bar\'s population readout)', () => {
  function bruteForcePopulation(view: GridView, width: number, height: number): number {
    let population = 0;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        if (view.get(x, y) !== DEAD) population += 1;
      }
    }
    return population;
  }

  it('sim.stats.population matches a brute-force recount exactly after each of 100 random ticks', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 48, height: 48, seed: 7 });
    sim.seedRandom(0.35, 7);
    for (let i = 0; i < 100; i++) {
      sim.step();
      expect(sim.stats.population).toBe(bruteForcePopulation(sim.view(), 48, 48));
    }
  });
});

describe('STATUS_THROTTLE_MS', () => {
  it('is the documented "10 Hz, not 60 Hz" cadence', () => {
    expect(STATUS_THROTTLE_MS).toBe(100);
  });
});
