/**
 * Growth classification (P2-C-4).
 *
 * Least-squares fit of population over a trailing sample ring to four
 * models — constant, linear, quadratic, exponential — and pick the best
 * by **adjusted R²**, with a parsimony tie-break so a still life is
 * constant, not a line with slope 0. Below {@link MIN_SAMPLES} the
 * classifier refuses: a research tool that confidently mislabels is
 * worse than one that abstains.
 *
 * The 95% band is the last fitted value ± 1.96 × residual SE. Always
 * display {@link describeGrowth}; the statistics panel (P2-D-3) renders
 * that string.
 *
 * Fitting is O(samples), never called from `StatsCollector.apply`.
 * `observe` is an O(1) ring push of `(tick, population)`.
 *
 * Instance-scoped: each classifier owns its ring. Two collectors share
 * nothing mutable.
 */
export const MIN_SAMPLES = 64;
/** Trailing ring length. 2048 gens is enough for a gun's p30 to drown in the linear trend. */
export const DEFAULT_CAPACITY = 2048;
/**
 * Adjusted-R² floor. A winner below this is `chaotic` rather than a
 * weakly-fitting law. 0.90 lets a clean gun/breeder through and keeps
 * pre-stabilisation soup from pretending to be quadratic.
 */
export const CHAOTIC_R2_FLOOR = 0.9;

export type GrowthKind =
  | 'insufficient-data'
  | 'constant'
  | 'linear'
  | 'quadratic'
  | 'exponential'
  | 'chaotic';

export interface GrowthBand {
  readonly lo: number;
  readonly hi: number;
}

export interface GrowthReport {
  readonly kind: GrowthKind;
  /** Unadjusted R² of the winning model (0 when abstaining). */
  readonly r2: number;
  readonly r2Adjusted: number;
  readonly samples: number;
  /** Residual standard error in cells. */
  readonly residualSe: number;
  /** 95% band on the last fitted population. */
  readonly band: GrowthBand;
  /**
   * Winning model coefficients, documented per kind:
   * constant `[a]`; linear `[a, b]` for `a + b x`;
   * quadratic `[a, b, c]` for `a + b x + c x²`;
   * exponential `[A, b]` for `A e^{b x}` (`x` is gens since the oldest sample).
   */
  readonly params: readonly number[];
}

export interface GrowthOptions {
  /** Trailing ring length. Default {@link DEFAULT_CAPACITY}. */
  readonly capacity?: number;
}

const EMPTY_BAND: GrowthBand = { lo: 0, hi: 0 };

const INSUFFICIENT: GrowthReport = {
  kind: 'insufficient-data',
  r2: 0,
  r2Adjusted: 0,
  samples: 0,
  residualSe: 0,
  band: EMPTY_BAND,
  params: [],
};

const KIND_ORDER: Record<Exclude<GrowthKind, 'insufficient-data' | 'chaotic'>, number> = {
  constant: 0,
  linear: 1,
  quadratic: 2,
  exponential: 3,
};

interface Candidate {
  readonly kind: Exclude<GrowthKind, 'insufficient-data' | 'chaotic'>;
  readonly r2: number;
  readonly r2Adj: number;
  readonly k: number;
  readonly ssRes: number;
  readonly params: readonly number[];
  readonly lastPred: number;
}

function adjR2(r2: number, n: number, k: number): number {
  if (n <= k) return r2;
  if (r2 >= 1) return 1;
  return 1 - (1 - r2) * ((n - 1) / (n - k));
}

function r2Of(ssRes: number, ssTot: number): number {
  if (ssTot <= 0) return ssRes <= 1e-12 ? 1 : 0;
  const v = 1 - ssRes / ssTot;
  if (v > 1) return 1;
  if (v < 0) return 0;
  return v;
}

function ssTotOf(ys: ArrayLike<number>, n: number): number {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ys[i]!;
  const mean = sum / n;
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = ys[i]! - mean;
    ss += d * d;
  }
  return ss;
}

function ssResOf(
  ys: ArrayLike<number>,
  n: number,
  pred: (i: number) => number,
): { ssRes: number; lastPred: number } {
  let ss = 0;
  let last = 0;
  for (let i = 0; i < n; i++) {
    last = pred(i);
    const d = ys[i]! - last;
    ss += d * d;
  }
  return { ssRes: ss, lastPred: last };
}

function better(a: Candidate, b: Candidate): boolean {
  const d = a.r2Adj - b.r2Adj;
  if (d > 1e-9) return true;
  if (d < -1e-9) return false;
  if (a.k !== b.k) return a.k < b.k;
  return KIND_ORDER[a.kind] < KIND_ORDER[b.kind];
}

function solve(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M: number[][] = [];
  for (let i = 0; i < n; i++) {
    const row = A[i]!;
    const copy = new Array<number>(n + 1);
    for (let j = 0; j < n; j++) copy[j] = row[j]!;
    copy[n] = b[i]!;
    M[i] = copy;
  }
  for (let col = 0; col < n; col++) {
    let pivot = col;
    let best = Math.abs(M[col]![col]!);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(M[r]![col]!);
      if (v > best) {
        best = v;
        pivot = r;
      }
    }
    if (best < 1e-12) return null;
    if (pivot !== col) {
      const tmp = M[col]!;
      M[col] = M[pivot]!;
      M[pivot] = tmp;
    }
    const diag = M[col]![col]!;
    for (let r = col + 1; r < n; r++) {
      const f = M[r]![col]! / diag;
      for (let c = col; c <= n; c++) {
        M[r]![c] = M[r]![c]! - f * M[col]![c]!;
      }
    }
  }
  const x = new Array<number>(n);
  for (let i = n - 1; i >= 0; i--) {
    let s = M[i]![n]!;
    for (let j = i + 1; j < n; j++) s -= M[i]![j]! * x[j]!;
    const d = M[i]![i]!;
    if (Math.abs(d) < 1e-12) return null;
    x[i] = s / d;
  }
  return x;
}

function fitConstant(ys: ArrayLike<number>, n: number, ssTot: number): Candidate {
  let sum = 0;
  for (let i = 0; i < n; i++) sum += ys[i]!;
  const a = sum / n;
  const { ssRes, lastPred } = ssResOf(ys, n, () => a);
  const r2 = r2Of(ssRes, ssTot);
  return {
    kind: 'constant',
    r2,
    r2Adj: adjR2(r2, n, 1),
    k: 1,
    ssRes,
    params: [a],
    lastPred,
  };
}

function fitLinear(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, ssTot: number): Candidate | null {
  let sX = 0;
  let sY = 0;
  let sXX = 0;
  let sXY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    sX += x;
    sY += y;
    sXX += x * x;
    sXY += x * y;
  }
  const sol = solve(
    [
      [n, sX],
      [sX, sXX],
    ],
    [sY, sXY],
  );
  if (!sol) return null;
  const a = sol[0]!;
  const b = sol[1]!;
  const { ssRes, lastPred } = ssResOf(ys, n, (i) => a + b * xs[i]!);
  const r2 = r2Of(ssRes, ssTot);
  return {
    kind: 'linear',
    r2,
    r2Adj: adjR2(r2, n, 2),
    k: 2,
    ssRes,
    params: [a, b],
    lastPred,
  };
}

function fitQuadratic(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, ssTot: number): Candidate | null {
  let sX = 0;
  let sX2 = 0;
  let sX3 = 0;
  let sX4 = 0;
  let sY = 0;
  let sXY = 0;
  let sX2Y = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ys[i]!;
    const x2 = x * x;
    sX += x;
    sX2 += x2;
    sX3 += x2 * x;
    sX4 += x2 * x2;
    sY += y;
    sXY += x * y;
    sX2Y += x2 * y;
  }
  const sol = solve(
    [
      [n, sX, sX2],
      [sX, sX2, sX3],
      [sX2, sX3, sX4],
    ],
    [sY, sXY, sX2Y],
  );
  if (!sol) return null;
  const a = sol[0]!;
  const b = sol[1]!;
  const c = sol[2]!;
  const { ssRes, lastPred } = ssResOf(ys, n, (i) => {
    const x = xs[i]!;
    return a + b * x + c * x * x;
  });
  const r2 = r2Of(ssRes, ssTot);
  return {
    kind: 'quadratic',
    r2,
    r2Adj: adjR2(r2, n, 3),
    k: 3,
    ssRes,
    params: [a, b, c],
    lastPred,
  };
}

function fitExponential(xs: ArrayLike<number>, ys: ArrayLike<number>, n: number, ssTot: number): Candidate | null {
  for (let i = 0; i < n; i++) {
    if (ys[i]! <= 0) return null;
  }
  const ln = new Float64Array(n);
  for (let i = 0; i < n; i++) ln[i] = Math.log(ys[i]!);
  let sX = 0;
  let sY = 0;
  let sXX = 0;
  let sXY = 0;
  for (let i = 0; i < n; i++) {
    const x = xs[i]!;
    const y = ln[i]!;
    sX += x;
    sY += y;
    sXX += x * x;
    sXY += x * y;
  }
  const sol = solve(
    [
      [n, sX],
      [sX, sXX],
    ],
    [sY, sXY],
  );
  if (!sol) return null;
  const lnA = sol[0]!;
  const b = sol[1]!;
  const A = Math.exp(lnA);
  if (!Number.isFinite(A) || !Number.isFinite(b)) return null;
  const { ssRes, lastPred } = ssResOf(ys, n, (i) => A * Math.exp(b * xs[i]!));
  if (!Number.isFinite(ssRes) || !Number.isFinite(lastPred)) return null;
  const r2 = r2Of(ssRes, ssTot);
  return {
    kind: 'exponential',
    r2,
    r2Adj: adjR2(r2, n, 2),
    k: 2,
    ssRes,
    params: [A, b],
    lastPred,
  };
}

function toReport(best: Candidate, n: number, chaotic: boolean): GrowthReport {
  const df = Math.max(1, n - best.k);
  const residualSe = Math.sqrt(best.ssRes / df);
  const half = 1.96 * residualSe;
  const kind: GrowthKind = chaotic ? 'chaotic' : best.kind;
  return {
    kind,
    r2: best.r2,
    r2Adjusted: best.r2Adj,
    samples: n,
    residualSe,
    band: { lo: best.lastPred - half, hi: best.lastPred + half },
    params: best.params,
  };
}

/**
 * Fit the four models to `n` population samples. `xs[i]` is gens since the
 * oldest sample (0 at the start of the trailing ring).
 */
export function classifyPopulation(
  xs: ArrayLike<number>,
  ys: ArrayLike<number>,
  n: number,
): GrowthReport {
  if (n < MIN_SAMPLES) {
    return { ...INSUFFICIENT, samples: n };
  }
  const ssTot = ssTotOf(ys, n);
  let best: Candidate = fitConstant(ys, n, ssTot);
  const linear = fitLinear(xs, ys, n, ssTot);
  if (linear && better(linear, best)) best = linear;
  const quad = fitQuadratic(xs, ys, n, ssTot);
  if (quad && better(quad, best)) best = quad;
  const exp = fitExponential(xs, ys, n, ssTot);
  if (exp && better(exp, best)) best = exp;

  const chaotic = best.r2Adj < CHAOTIC_R2_FLOOR;
  return toReport(best, n, chaotic);
}

/**
 * User-facing label. Abstentions and approximations always say so — this
 * is the string the statistics panel (P2-D-3) must render.
 */
export function describeGrowth(report: GrowthReport): string {
  const n = report.samples;
  if (report.kind === 'insufficient-data') {
    return `Insufficient data (${n}/${MIN_SAMPLES} samples)`;
  }
  const r2 = `R² = ${report.r2.toFixed(3)}`;
  const half = Math.max(0, Math.round((report.band.hi - report.band.lo) / 2));
  const band = `±${half} cells`;
  switch (report.kind) {
    case 'chaotic':
      return `Chaotic — no simple growth law (best ${r2})`;
    case 'constant':
      return `Constant population (${r2}, ${band})`;
    case 'linear':
      return `Linear growth (${r2}, ${band})`;
    case 'quadratic':
      return `Quadratic growth (${r2}, ${band})`;
    case 'exponential':
      return `Exponential growth (${r2}, ${band})`;
  }
}

export class GrowthClassifier {
  readonly capacity: number;
  private readonly ticks: Float64Array;
  private readonly pops: Float64Array;
  private readonly xs: Float64Array;
  private readonly ys: Float64Array;
  private write = 0;
  private filled = 0;
  private cached: GrowthReport = INSUFFICIENT;
  private dirty = true;

  constructor(opts: GrowthOptions = {}) {
    const capacity = opts.capacity ?? DEFAULT_CAPACITY;
    if (capacity < MIN_SAMPLES || (capacity | 0) !== capacity) {
      throw new RangeError(`growth capacity must be an integer >= ${MIN_SAMPLES}, got ${capacity}`);
    }
    this.capacity = capacity;
    this.ticks = new Float64Array(capacity);
    this.pops = new Float64Array(capacity);
    this.xs = new Float64Array(capacity);
    this.ys = new Float64Array(capacity);
  }

  get last(): GrowthReport {
    return this.classify();
  }

  get sampleCount(): number {
    return this.filled;
  }

  reset(): void {
    this.write = 0;
    this.filled = 0;
    this.cached = INSUFFICIENT;
    this.dirty = true;
  }

  /** O(1) ring push. */
  observe(tick: number, population: number): void {
    this.ticks[this.write] = tick;
    this.pops[this.write] = population;
    this.write = (this.write + 1) % this.capacity;
    if (this.filled < this.capacity) this.filled += 1;
    this.dirty = true;
  }

  classify(): GrowthReport {
    if (!this.dirty) return this.cached;
    this.dirty = false;
    const n = this.filled;
    if (n < MIN_SAMPLES) {
      this.cached = { ...INSUFFICIENT, samples: n };
      return this.cached;
    }
    const cap = this.capacity;
    const start = this.filled === cap ? this.write : 0;
    const t0 = this.ticks[start]!;
    const xs = this.xs;
    const ys = this.ys;
    for (let k = 0; k < n; k++) {
      const idx = (start + k) % cap;
      xs[k] = this.ticks[idx]! - t0;
      ys[k] = this.pops[idx]!;
    }
    this.cached = classifyPopulation(xs, ys, n);
    return this.cached;
  }
}
