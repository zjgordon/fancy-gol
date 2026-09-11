/**
 * Chart scales (P2-D-1). Linear, log, and generation-time, plus the 1/2/5 × 10ⁿ
 * nice-tick generator. Pure number in, number out — no canvas, no DOM.
 *
 * Log Y must never emit NaN geometry: zeros and negatives clamp to the
 * positive floor of the domain so a births-or-entropy trace that dips to 0
 * still draws. Approximations stay labelled at the chart, not here.
 */

export type ScaleKind = 'linear' | 'log' | 'time';

export interface Scale {
  readonly kind: ScaleKind;
  readonly domain: readonly [number, number];
  readonly range: readonly [number, number];
  convert(value: number): number;
  invert(px: number): number;
  ticks(count: number): number[];
}

const LOG_FLOOR = 1e-9;

function finite(n: number, fallback: number): number {
  return Number.isFinite(n) ? n : fallback;
}

/** Smallest 1/2/5 × 10ⁿ step that covers `span` with about `count` intervals. */
export function niceStep(span: number, count: number): number {
  const n = Math.max(1, count);
  const raw = Math.abs(span) / n;
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const exp = Math.floor(Math.log10(raw));
  const frac = raw / 10 ** exp;
  let nice: number;
  if (frac <= 1) nice = 1;
  else if (frac <= 2) nice = 2;
  else if (frac <= 5) nice = 5;
  else nice = 10;
  return nice * 10 ** exp;
}

/** Expand `[min, max]` onto a 1/2/5 × 10ⁿ grid. Identical values still get a unit span. */
export function niceDomain(min: number, max: number, count = 5): readonly [number, number] {
  let lo = finite(min, 0);
  let hi = finite(max, 1);
  if (lo > hi) {
    const t = lo;
    lo = hi;
    hi = t;
  }
  if (hi === lo) {
    const pad = Math.abs(lo) > 0 ? Math.abs(lo) * 0.5 : 1;
    return [lo - pad, hi + pad];
  }
  const step = niceStep(hi - lo, count);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/**
 * Inclusive ticks from a nice domain. `count` is a hint — the 1/2/5 rule
 * decides the actual step so labels stay round.
 */
export function niceTicks(min: number, max: number, count = 5): number[] {
  const [lo, hi] = niceDomain(min, max, count);
  const step = niceStep(hi - lo, count);
  const ticks: number[] = [];
  const start = lo;
  const n = Math.max(1, Math.round((hi - lo) / step));
  for (let i = 0; i <= n; i++) {
    const v = start + i * step;
    if (v > hi + step * 1e-9) break;
    ticks.push(Number(v.toPrecision(12)));
  }
  if (ticks.length === 0) ticks.push(lo, hi);
  if (ticks[ticks.length - 1] !== hi && hi - (ticks[ticks.length - 1] ?? hi) > step * 1e-6) {
    ticks.push(hi);
  }
  return ticks;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function unlerp(a: number, b: number, v: number): number {
  if (a === b) return 0;
  return (v - a) / (b - a);
}

function clamp01(t: number): number {
  if (t < 0) return 0;
  if (t > 1) return 1;
  return t;
}

export function linearScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const d0 = finite(domain[0], 0);
  const d1 = finite(domain[1], 1);
  const r0 = finite(range[0], 0);
  const r1 = finite(range[1], 1);
  return {
    kind: 'linear',
    domain: [d0, d1],
    range: [r0, r1],
    convert(value: number) {
      const v = finite(value, d0);
      return lerp(r0, r1, unlerp(d0, d1, v));
    },
    invert(px: number) {
      return lerp(d0, d1, unlerp(r0, r1, finite(px, r0)));
    },
    ticks(count: number) {
      return niceTicks(d0, d1, count);
    },
  };
}

/**
 * Log scale. Domain values ≤ 0 map to the start of the range (the positive
 * floor), never to NaN. An all-non-positive domain falls back to linear so a
 * chart that asked for log still has geometry.
 */
export function logScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const raw0 = finite(domain[0], 1);
  const raw1 = finite(domain[1], 10);
  const lo = Math.min(raw0, raw1);
  const hi = Math.max(raw0, raw1);
  const r0 = finite(range[0], 0);
  const r1 = finite(range[1], 1);

  if (!(hi > 0)) {
    return { ...linearScale([lo, hi], [r0, r1]), kind: 'log' };
  }

  const d0 = Math.max(lo, LOG_FLOOR);
  const d1 = Math.max(hi, d0 * 10);
  const l0 = Math.log10(d0);
  const l1 = Math.log10(d1);

  return {
    kind: 'log',
    domain: [d0, d1],
    range: [r0, r1],
    convert(value: number) {
      if (!Number.isFinite(value) || value <= 0) return r0;
      const lv = Math.log10(Math.max(value, d0));
      const t = clamp01(unlerp(l0, l1, lv));
      return lerp(r0, r1, t);
    },
    invert(px: number) {
      const t = clamp01(unlerp(r0, r1, finite(px, r0)));
      return 10 ** lerp(l0, l1, t);
    },
    ticks(count: number) {
      return logTicks(d0, d1, count);
    },
  };
}

/** Decade ticks, with 2/5 subdivisions when the span is narrow. */
export function logTicks(min: number, max: number, count = 5): number[] {
  const lo = Math.max(min, LOG_FLOOR);
  const hi = Math.max(max, lo * 10);
  const e0 = Math.floor(Math.log10(lo));
  const e1 = Math.ceil(Math.log10(hi));
  const ticks: number[] = [];
  const decades = e1 - e0;
  const subs = decades <= 2 ? [1, 2, 5] : [1];
  for (let e = e0; e <= e1; e++) {
    const base = 10 ** e;
    for (const s of subs) {
      const v = base * s;
      if (v >= lo * 0.999 && v <= hi * 1.001) ticks.push(v);
    }
  }
  if (ticks.length < 2) return niceTicks(lo, hi, count);
  return ticks;
}

/** Generation axis: linear scale whose ticks prefer integers. */
export function timeScale(
  domain: readonly [number, number],
  range: readonly [number, number],
): Scale {
  const inner = linearScale(domain, range);
  return {
    ...inner,
    kind: 'time',
    ticks(count: number) {
      const raw = niceTicks(inner.domain[0], inner.domain[1], count);
      return raw.map((t) => (Math.abs(t) >= 1 ? Math.round(t) : t));
    },
  };
}
