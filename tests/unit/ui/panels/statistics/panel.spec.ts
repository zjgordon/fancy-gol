import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import type { StatsWindowPoint } from '@shared/protocol';
import { DEFAULT_DARK_THEME } from '@themes/default/theme';
import { ChartLoop, chartTokensFromSet, type ChartWindow } from '@ui/charts/chart';
import { createStatisticsPanel, STATS_PANEL_ID, STATS_PANEL_MIN_WIDTH } from '@ui/panels/statistics/panel';
import { attachPanelHost } from '@ui/shell/panel-host';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';

class FakeCtx {
  lineWidth = 1;
  strokeStyle = '';
  fillStyle = '';
  font = '';
  textAlign = 'left';
  textBaseline = 'alphabetic';
  setTransform(): void {}
  save(): void {}
  restore(): void {}
  clearRect(): void {}
  beginPath(): void {}
  moveTo(): void {}
  lineTo(): void {}
  arc(): void {}
  stroke(): void {}
  fill(): void {}
  closePath(): void {}
  fillRect(): void {}
  strokeRect(): void {}
  measureText(text: string): { width: number } {
    return { width: text.length * 6 };
  }
  fillText(): void {}
}

function point(tick: number, pop: number): StatsWindowPoint {
  return {
    tick,
    population: pop,
    populationMin: pop,
    populationMax: pop,
    perState: Uint32Array.from([0, pop]),
    births: 1,
    deaths: 0,
    transitions: 0,
    activity: 1,
    density: 0.1,
    bbox: { x: 0, y: 0, width: 4, height: 4 },
    centroid: { x: 1, y: 1 },
    entropy: 0.5,
    hash: 0xabc,
    tier: 0,
  };
}

function windowOf(points: readonly StatsWindowPoint[]): ChartWindow {
  return {
    points,
    tier: 0,
    aggregated: false,
    downsampled: false,
    sourceCount: points.length,
    label: 'Tier 0 (exact)',
  };
}

describe('createStatisticsPanel', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  function setup() {
    const loop = new ChartLoop({
      scheduler: { request: () => 1, cancel: () => {} },
      clock: { now: () => 0 },
    });
    const onExport = vi.fn();
    const panel = createStatisticsPanel({
      tokens: chartTokensFromSet(DEFAULT_DARK_THEME.tokens),
      motion: DEFAULT_DARK_THEME.motion,
      loop,
      ctxFor: () => new FakeCtx() as unknown as CanvasRenderingContext2D,
      onExport,
    });
    const mount = document.createElement('div');
    document.body.appendChild(mount);
    const host = attachPanelHost({ mount, getViewportWidth: () => 1000 });
    host.register(panel.spec);
    return { panel, host, loop, onExport };
  }

  it('opens in simple mode a child can read, with no legend', () => {
    const { panel, host } = setup();
    host.open(STATS_PANEL_ID);
    panel.updateLive({
      tick: 12,
      population: 36,
      births: 4,
      deaths: 1,
      transitions: 0,
      activity: 5,
      activeChunks: 2,
      stepMicros: 80,
    });
    expect(panel.getMode()).toBe('simple');
    expect(panel.root.querySelector('.stats-simple')?.hasAttribute('hidden')).toBe(false);
    expect(panel.root.textContent).toContain('Alive now');
    expect(panel.root.textContent).toContain('36');
    expect(panel.root.textContent).toContain('Generation');
    expect(panel.root.textContent).toContain('12');
    expect(panel.root.querySelector('.stats-advanced')?.hasAttribute('hidden')).toBe(true);
    expect(panel.root.textContent).not.toMatch(/legend/i);
    panel.dispose();
    host.dispose();
  });

  it('advanced mode lists every collected metric and shows a dismissible cycle finding', () => {
    const { panel, host } = setup();
    host.open(STATS_PANEL_ID);
    panel.setMode('advanced');
    panel.setWindow(windowOf([point(10, 8), point(11, 9)]), {
      entropyLabel: '0.50 bits (exact)',
      growthLabel: 'Insufficient data (2/64 samples)',
      cycle: { kind: 'oscillator', period: 30, detectedAt: 412, displacement: { x: 0, y: 0 } },
      windowLabel: 'Tier 0 (exact)',
      flux: Int32Array.from([0, 2, -1]),
    });
    expect(panel.root.textContent).toContain('Period 30 oscillator detected at generation 412');
    expect(panel.root.textContent).toContain('0.50 bits (exact)');
    expect(panel.root.textContent).toContain('Insufficient data');
    expect(panel.root.textContent).toContain('Population');
    expect(panel.root.textContent).toContain('Births');
    expect(panel.root.textContent).toContain('Deaths');
    expect(panel.root.textContent).toContain('Transitions');
    expect(panel.root.textContent).toContain('Activity');
    expect(panel.root.textContent).toContain('Density');
    expect(panel.root.textContent).toContain('Live box');
    expect(panel.root.textContent).toContain('Centroid');
    expect(panel.root.textContent).toContain('Entropy');
    expect(panel.root.textContent).toContain('Hash');
    expect(panel.root.textContent).toContain('Active chunks');
    expect(panel.root.textContent).toContain('Flux');
    expect(panel.root.textContent).toContain('Per state');
    panel.dismissFinding();
    expect(panel.root.querySelector('.stats-finding')?.hasAttribute('hidden')).toBe(true);
    expect(STATS_PANEL_MIN_WIDTH).toBeGreaterThanOrEqual(240);
    panel.dispose();
    host.dispose();
  });

  it('opens in under 50 ms and does not need a worker query to paint simple mode', () => {
    const t0 = performance.now();
    const { panel, host } = setup();
    host.open(STATS_PANEL_ID);
    panel.updateLive({
      tick: 1,
      population: 5,
      births: 0,
      deaths: 0,
      transitions: 0,
      activity: 0,
      activeChunks: 1,
      stepMicros: 10,
    });
    const elapsed = performance.now() - t0;
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(50);
    panel.dispose();
    host.dispose();
  });

  it('exposes the current window and an Export control', () => {
    const { panel, host, onExport } = setup();
    host.open(STATS_PANEL_ID);
    const data = windowOf([point(1, 4)]);
    panel.setWindow(data, {
      entropyLabel: 'exact',
      growthLabel: 'Insufficient data',
      cycle: null,
      windowLabel: 'Tier 0 (exact)',
      flux: Int32Array.from([0]),
    });
    expect(panel.getWindow()?.label).toBe(data.label);
    panel.root.querySelector<HTMLButtonElement>('.stats-export')!.click();
    expect(onExport).toHaveBeenCalled();
    panel.dispose();
    host.dispose();
  });

  it('has zero axe-core violations on the panel root in both modes', async () => {
    const { panel, host } = setup();
    host.open(STATS_PANEL_ID);
    expect((await axe.run(panel.root)).violations).toEqual([]);
    panel.setMode('advanced');
    expect((await axe.run(panel.root)).violations).toEqual([]);
    panel.dispose();
    host.dispose();
  });
});
