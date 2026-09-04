/**
 * Flood fill: click a cell and every same-state cell reachable through 4-connected neighbours
 * gets repainted. A scanline fill (whole horizontal runs at a time, not cell-by-cell), hard
 * capped both by cell count (default {@link DEFAULT_FILL_CAP}) and by wall-clock time (default
 * {@link DEFAULT_FILL_TIMEOUT_MS}) — a flood fill on an unbounded same-state field is otherwise
 * a hang, not just a slow operation. The time cap is what actually makes "completes in < 500 ms
 * *or* prompts" hold in every environment: at the full 1,000,000-cell scale, a `Set`-keyed
 * scanline fill's own baseline cost (dedup bookkeeping, not the algorithm's shape) sits close
 * enough to that budget that a slower machine or a noisy CI box can tip it over on cell-count
 * alone — bounding by time directly, rather than hoping the cell cap is always reached first,
 * guarantees the criterion regardless of the underlying hardware. `capped` is readable after a
 * fill either way, so a caller can show a confirmation prompt (a DOM/dialog concern, out of this
 * task's file scope).
 *
 * This is the one tool in this task that needs read access to the live grid — see `tool.ts`'s
 * `ToolContext.grid` for the seam and its own caveat about who actually supplies one today.
 */
import { packXY } from './brush';
import { REAL_CLOCK, type Clock } from '@ui/input/gestures';
import type { GridView, PaintOp, StateId } from '@shared/types';
import type { Tool, ToolContext } from './tool';

export const DEFAULT_FILL_CAP = 1_000_000;
/** Comfortably under the 500ms acceptance budget, leaving headroom for a slower environment. */
export const DEFAULT_FILL_TIMEOUT_MS = 400;

export interface FillOptions {
  readonly state?: StateId;
  readonly cap?: number;
  readonly timeoutMs?: number;
  readonly clock?: Clock;
}

export class FillTool implements Tool {
  readonly id = 'fill';
  readonly cursor = 'crosshair';
  state: StateId;
  cap: number;
  timeoutMs: number;

  /** Whether the most recent fill stopped early because it hit `cap` or `timeoutMs`. */
  capped = false;

  private readonly clock: Clock;
  private currentOps: readonly PaintOp[] = [];

  constructor(options: FillOptions = {}) {
    this.state = options.state ?? 1;
    this.cap = options.cap ?? DEFAULT_FILL_CAP;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_FILL_TIMEOUT_MS;
    this.clock = options.clock ?? REAL_CLOCK;
  }

  onDown(ctx: ToolContext): void {
    this.currentOps = [];
    this.capped = false;
    if (!ctx.grid) return;

    const x0 = Math.round(ctx.event.point.x);
    const y0 = Math.round(ctx.event.point.y);
    const target = ctx.grid.get(x0, y0);
    if (target === this.state) return; // already this state: nothing to fill

    const result = scanlineFill(ctx.grid, x0, y0, target, this.state, this.cap, this.timeoutMs, this.clock);
    this.currentOps = result.cells;
    this.capped = result.capped;
  }

  onMove(): void {
    // Flood fill commits from its down-point only; where the pointer drags to afterward
    // doesn't change what would be filled.
  }

  onUp(): readonly PaintOp[] {
    const ops = this.currentOps;
    this.currentOps = [];
    return ops;
  }

  onCancel(): void {
    this.currentOps = [];
    this.capped = false;
  }

  preview(): readonly PaintOp[] {
    return this.currentOps;
  }
}

/**
 * Classic scanline flood fill: fills whole horizontal runs, then seeds the rows above/below at
 * each new run found — one stack push per contiguous run, not per cell. Builds `PaintOp`s
 * directly (rather than a `[x,y]` tuple array mapped to `PaintOp`s afterward) — at the 1M-cell
 * scale this task is explicitly budgeted for, halving the allocation count is the difference
 * between comfortably inside and right up against the 500ms ceiling.
 *
 * Cells are recorded *incrementally* while each direction is probed, not only after its full
 * extent is known — walking an unbounded same-state row's extent could otherwise consume the
 * entire budget before a single cell is ever recorded as filled, leaving nothing painted at all
 * rather than a legible, capped, partial fill. `reads` additionally bounds total grid probes
 * (not just filled cells), as a backstop against pathological non-fillable probing (e.g.
 * repeatedly checking a boundary edge along a very long, mostly-empty row).
 */
function scanlineFill(
  grid: GridView,
  seedX: number,
  seedY: number,
  target: StateId,
  paintState: StateId,
  cap: number,
  timeoutMs: number,
  clock: Clock,
): { cells: PaintOp[]; capped: boolean } {
  const readBudget = cap * 8;
  const deadline = clock.now() + timeoutMs;
  // Checking the clock is real overhead too (a syscall-backed timer, not free) — worth paying
  // only occasionally, not on every single grid probe.
  const TIME_CHECK_INTERVAL = 4096;
  let reads = 0;
  let timedOut = false;
  const isTarget = (x: number, y: number): boolean => {
    reads++;
    if (!timedOut && reads % TIME_CHECK_INTERVAL === 0 && clock.now() >= deadline) {
      timedOut = true;
    }
    return grid.get(x, y) === target;
  };
  const withinBudget = (): boolean => !timedOut && reads < readBudget;

  const filled = new Set<number>();
  const cells: PaintOp[] = [];
  let capped = false;

  /** Records a cell if it's new and there's still cap headroom. Returns whether it was added. */
  function tryAdd(x: number, y: number): boolean {
    if (filled.size >= cap) {
      capped = true;
      return false;
    }
    const key = packXY(x, y);
    if (filled.has(key)) return false;
    filled.add(key);
    cells.push({ x, y, state: paintState });
    return true;
  }

  const stack: Array<readonly [number, number]> = [[seedX, seedY]];

  while (stack.length > 0 && !capped) {
    if (!withinBudget()) {
      capped = true;
      break;
    }
    const [x, y] = stack.pop()!;
    if (filled.has(packXY(x, y)) || !isTarget(x, y)) continue;
    if (!tryAdd(x, y)) break;

    let xl = x;
    while (!capped && withinBudget() && isTarget(xl - 1, y)) {
      xl--;
      if (!tryAdd(xl, y)) break;
    }
    let xr = x;
    while (!capped && withinBudget() && isTarget(xr + 1, y)) {
      xr++;
      if (!tryAdd(xr, y)) break;
    }
    if (capped) break;

    for (const ny of [y - 1, y + 1]) {
      let xi = xl;
      while (xi <= xr && !capped && withinBudget()) {
        if (!filled.has(packXY(xi, ny)) && isTarget(xi, ny)) {
          stack.push([xi, ny]);
          while (xi <= xr && withinBudget() && isTarget(xi, ny)) xi++;
        } else {
          xi++;
        }
      }
      if (capped) break;
    }
  }

  // The budget can be exhausted at a point where the stack also happens to empty out (nothing
  // left *queued*, but that's only because probing stopped, not because completeness was
  // proven) — `capped` must reflect running out, not merely whether the loop's own exit
  // condition happened to be `stack.length > 0` going false first.
  capped ||= !withinBudget();

  return { cells, capped };
}
