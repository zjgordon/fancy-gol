/**
 * Dirty-rect accumulation and merging (P0-H-1). A renderer redraws only what changed; this
 * module turns a stream of changed regions (one `Rect` per touched chunk is the typical input —
 * see `worker/handler.ts`'s `frame.dirty`) into a small, exact covering rect list, or gives up
 * and signals a full repaint once merging would cost more than it saves.
 *
 * Pure geometry — no chunk maths, no engine import. `render/` may only import `shared/`
 * (ADR-009); a caller that has chunk keys converts them to world `Rect`s before this module ever
 * sees them (already done once, by `worker/handler.ts`, on the way to `RenderFrame.dirty`).
 */
import type { Rect } from '@shared/types';

/** Hard cap independent of area: merging thousands of rects costs more than just repainting. */
const MAX_MERGE_RECTS = 4096;

/** Default share of the viewport's area beyond which merging isn't worth it. */
const DEFAULT_GIVE_UP_FRACTION = 0.6;

export interface MergeOptions {
  /** The visible world region, for the give-up heuristic's area comparison. */
  readonly viewport: Rect;
  /** Fraction of `viewport`'s area beyond which `mergeDirtyRects` gives up and returns `null`. Default 0.6. */
  readonly giveUpFraction?: number;
}

function rectArea(r: Rect): number {
  return Math.max(0, r.width) * Math.max(0, r.height);
}

function lowerBound(sorted: readonly number[], value: number): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid]! < value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * Merges overlapping and edge-adjacent rects into a minimal-ish disjoint set covering exactly
 * the same cells as the input — coordinate compression down to a boolean grid, then a
 * row-run merge followed by a vertical merge of matching runs across consecutive rows. Returns
 * `null` (full repaint) if there are simply too many rects, or their combined area already
 * exceeds `giveUpFraction` of the viewport — the same 60%-ish "repainting is cheaper" heuristic
 * that guards against ever running the O(rects²)-ish merge on a pathological input.
 */
export function mergeDirtyRects(rects: readonly Rect[], opts: MergeOptions): readonly Rect[] | null {
  const positive = rects.filter((r) => r.width > 0 && r.height > 0);
  if (positive.length === 0) return [];

  if (positive.length > MAX_MERGE_RECTS) return null;

  const giveUpFraction = opts.giveUpFraction ?? DEFAULT_GIVE_UP_FRACTION;
  const viewportArea = rectArea(opts.viewport);
  if (viewportArea > 0) {
    let totalArea = 0;
    for (const r of positive) totalArea += rectArea(r);
    if (totalArea > giveUpFraction * viewportArea) return null;
  }

  return unionToRects(positive);
}

/** The exact merge, with no size-based bail-out — `mergeDirtyRects` is the size-aware entry point; this is what the property test exercises directly. */
export function unionToRects(rects: readonly Rect[]): readonly Rect[] {
  const positive = rects.filter((r) => r.width > 0 && r.height > 0);
  if (positive.length === 0) return [];

  const xsSet = new Set<number>();
  const ysSet = new Set<number>();
  for (const r of positive) {
    xsSet.add(r.x);
    xsSet.add(r.x + r.width);
    ysSet.add(r.y);
    ysSet.add(r.y + r.height);
  }
  const xs = [...xsSet].sort((a, b) => a - b);
  const ys = [...ysSet].sort((a, b) => a - b);
  const nx = xs.length - 1;
  const ny = ys.length - 1;

  const covered = new Uint8Array(nx * ny);
  for (const r of positive) {
    const x0 = lowerBound(xs, r.x);
    const x1 = lowerBound(xs, r.x + r.width);
    const y0 = lowerBound(ys, r.y);
    const y1 = lowerBound(ys, r.y + r.height);
    for (let row = y0; row < y1; row++) {
      const base = row * nx;
      for (let col = x0; col < x1; col++) covered[base + col] = 1;
    }
  }

  interface OpenRun {
    readonly colStart: number;
    readonly colEnd: number;
    readonly rowStart: number;
  }

  const output: Rect[] = [];
  const toRect = (run: OpenRun, rowEndExclusive: number): Rect => ({
    x: xs[run.colStart]!,
    y: ys[run.rowStart]!,
    width: xs[run.colEnd]! - xs[run.colStart]!,
    height: ys[rowEndExclusive]! - ys[run.rowStart]!,
  });

  let open = new Map<string, OpenRun>();
  for (let row = 0; row < ny; row++) {
    const nextOpen = new Map<string, OpenRun>();
    let col = 0;
    while (col < nx) {
      if (!covered[row * nx + col]) {
        col++;
        continue;
      }
      const colStart = col;
      while (col < nx && covered[row * nx + col]) col++;
      const key = `${colStart}:${col}`;
      const existing = open.get(key);
      nextOpen.set(key, existing ?? { colStart, colEnd: col, rowStart: row });
      if (existing) open.delete(key);
    }
    // Anything still open from the previous row but not matched this row is done growing.
    for (const run of open.values()) output.push(toRect(run, row));
    open = nextOpen;
  }
  for (const run of open.values()) output.push(toRect(run, ny));

  return output;
}

/**
 * Stateful batching across ticks: `add` records one frame's dirty regions, `take` returns the
 * merged covering rect list (or `null`) accumulated since the last `take` and clears it. This is
 * what lets a render loop that skipped a few coalesced frames (`WorkerClient`'s own coalescing,
 * P0-G-3) still repaint everything that actually changed, not just the latest frame's own list.
 */
export class DirtyAccumulator {
  private pending: Rect[] = [];
  private viewport: Rect;
  private readonly giveUpFraction: number;

  constructor(viewport: Rect, giveUpFraction = DEFAULT_GIVE_UP_FRACTION) {
    this.viewport = viewport;
    this.giveUpFraction = giveUpFraction;
  }

  setViewport(viewport: Rect): void {
    this.viewport = viewport;
  }

  add(rects: readonly Rect[]): void {
    this.pending.push(...rects);
  }

  /** Merges and clears the accumulated regions. `null` means the caller should do a full repaint. */
  take(): readonly Rect[] | null {
    const result = mergeDirtyRects(this.pending, { viewport: this.viewport, giveUpFraction: this.giveUpFraction });
    this.pending = [];
    return result;
  }
}
