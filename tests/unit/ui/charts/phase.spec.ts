import { describe, expect, it } from 'vitest';
import type { StatsWindowPoint } from '@shared/protocol';
import { DEFAULT_DARK_THEME } from '@themes/default/theme';
import { DEFAULT_DARK_TOKENS } from '@themes/default/tokens';
import { CHART_HZ } from '@ui/charts/chart';
import { drawPhase, trailAlpha, trailLength } from '@ui/charts/phase';

class FakeCtx {
  lineWidth = 1;
  lineCap = 'butt';
  lineJoin = 'miter';
  strokeStyle = '';
  fillStyle = '';
  readonly strokes: { style: string }[] = [];
  fillCount = 0;
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  stroke(): void {
    this.strokes.push({ style: String(this.strokeStyle) });
  }
  fill(): void {
    this.fillCount++;
  }
  arc(): void {}
}

function point(tick: number, population: number, births: number): StatsWindowPoint {
  return {
    tick,
    population,
    populationMin: population,
    populationMax: population,
    perState: new Uint32Array([0, population]),
    births,
    deaths: 0,
    transitions: 0,
    activity: births,
    density: 0,
    bbox: { x: 0, y: 0, width: 1, height: 1 },
    centroid: { x: 0, y: 0 },
    entropy: 0,
    hash: tick,
    tier: 0,
  };
}

const motion = DEFAULT_DARK_THEME.motion;
const plot = { x: 8, y: 8, width: 200, height: 160 };

function alphasFrom(strokes: readonly { style: string }[]): number[] {
  return strokes.map((s) => {
    const m = /rgba\(\s*[\d.]+\s*,\s*[\d.]+\s*,\s*[\d.]+\s*,\s*([\d.]+)\s*\)/.exec(s.style);
    return m ? Number(m[1]) : 1;
  });
}

describe('trailLength / trailAlpha', () => {
  it('sizes the tail from a motion-token duration at the chart cadence', () => {
    expect(trailLength(motion.durationMs.slow, CHART_HZ)).toBe(Math.round((600 * 20) / 1000));
    expect(trailLength(0)).toBe(2);
  });

  it('is a pure function of index — stable across 20 Hz redraws', () => {
    const fade = motion.easings.standard;
    const n = 30;
    const len = trailLength(motion.durationMs.slow, CHART_HZ);
    const first = Array.from({ length: n }, (_, i) => trailAlpha(i, n, len, fade));
    const again = Array.from({ length: n }, (_, i) => trailAlpha(i, n, len, fade));
    expect(again).toEqual(first);
    expect(first[0]).toBe(0);
    expect(first[n - 1]).toBe(1);
  });

  it('uses the injected motion curve, not a hardcoded fade', () => {
    const n = 12;
    const len = 12;
    const zero = Array.from({ length: n }, (_, i) => trailAlpha(i, n, len, () => 0));
    const one = Array.from({ length: n }, (_, i) => trailAlpha(i, n, len, () => 1));
    const quad = Array.from({ length: n }, (_, i) => trailAlpha(i, n, len, (t) => t * t));
    expect(zero.every((a) => a === 0)).toBe(true);
    expect(one.every((a) => a === 1)).toBe(true);
    expect(quad[n - 1]).toBe(1);
    expect(quad[Math.floor(n / 2)]).toBeLessThan(quad[n - 1]!);
  });
});

describe('drawPhase', () => {
  it('strokes a fading trail and a head, identical at two 20 Hz frames', () => {
    const points = Array.from({ length: 24 }, (_, t) => point(t, 10 + (t % 5), t % 4));
    const fade = { curve: motion.easings.standard, durationMs: motion.durationMs.slow };
    const style = { color: DEFAULT_DARK_TOKENS.color.accent };

    const a = new FakeCtx();
    drawPhase({ ctx: a as unknown as CanvasRenderingContext2D, plot, points, x: (p) => p.population, y: (p) => p.births, fade, style });
    const b = new FakeCtx();
    drawPhase({ ctx: b as unknown as CanvasRenderingContext2D, plot, points, x: (p) => p.population, y: (p) => p.births, fade, style });

    expect(a.strokes.length).toBeGreaterThan(0);
    expect(a.fillCount).toBe(1);
    expect(alphasFrom(b.strokes)).toEqual(alphasFrom(a.strokes));
    const alphas = alphasFrom(a.strokes);
    expect(alphas[0]!).toBeLessThan(alphas[alphas.length - 1]!);
  });

  it('draws nothing visible when the motion curve is identically zero', () => {
    const points = [point(0, 4, 1), point(1, 8, 2), point(2, 6, 3)];
    const ctx = new FakeCtx();
    drawPhase({
      ctx: ctx as unknown as CanvasRenderingContext2D,
      plot,
      points,
      x: (p) => p.population,
      y: (p) => p.births,
      fade: { curve: () => 0, durationMs: motion.durationMs.slow },
      style: { color: DEFAULT_DARK_TOKENS.color.accent },
    });
    expect(ctx.strokes).toHaveLength(0);
    expect(ctx.fillCount).toBe(0);
  });
});
