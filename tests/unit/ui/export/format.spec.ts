import { describe, expect, it } from 'vitest';
import type { StatsWindowPoint } from '@shared/protocol';
import type { ChartWindow } from '@ui/charts/chart';
import { formatExportNumber, formatSeriesCsv, formatSeriesJson, seriesExportWarning } from '@ui/export/format';

function point(tick: number, pop: number): StatsWindowPoint {
  return {
    tick,
    population: pop,
    populationMin: pop - 1,
    populationMax: pop + 1,
    perState: Uint32Array.from([0, pop]),
    births: 1.5,
    deaths: 0,
    transitions: 0,
    activity: 1,
    density: 0.25,
    bbox: { x: 0, y: 0, width: 4, height: 4 },
    centroid: { x: 1.25, y: 2 },
    entropy: 0.5,
    hash: 255,
    tier: 1,
  };
}

function win(over: Partial<ChartWindow> = {}): ChartWindow {
  return {
    points: [point(0, 10), point(16, 12.5)],
    tier: 1,
    aggregated: true,
    downsampled: true,
    sourceCount: 4096,
    label: 'Tier 1 (min/mean/max, every 16 ticks, LTTB to 2 points)',
    ...over,
  };
}

describe('formatExportNumber', () => {
  it('never emits a locale decimal comma', () => {
    expect(formatExportNumber(12.5)).toBe('12.5');
    expect(formatExportNumber(12.5)).not.toContain(',');
    expect(formatExportNumber(3)).toBe('3');
  });
});

describe('formatSeriesCsv', () => {
  it('has spreadsheet headers and labels every downsampled column', () => {
    const csv = formatSeriesCsv(win());
    const lines = csv.trimEnd().split('\n');
    expect(lines[0]).toBe('# fancy-gol statistics export');
    expect(csv).toContain('# WARNING: downsampled or aggregated');
    expect(csv).toContain('# decimal: ASCII period (.)');
    expect(csv).toMatch(/# column population: tier 1; aggregation .*min\/mean\/max/);
    expect(csv).toMatch(/# column population_min: tier 1; aggregation /);
    expect(csv).toContain('tick,population,population_min,population_max,births');
    const data = lines.filter((l) => !l.startsWith('#') && !l.startsWith('tick,'));
    expect(data[0]).toContain('0,10,9,11,1.5');
    expect(data[1]).toContain('16,12.5');
    expect(data.join('\n')).toContain('1.5');
    expect(data.join('\n')).not.toContain('1,5');
  });

  it('marks an exact tier-0 window as exact, with no warning', () => {
    const exact = win({
      tier: 0,
      aggregated: false,
      downsampled: false,
      label: 'Tier 0 (every tick)',
      points: [point(1, 4)],
    });
    expect(seriesExportWarning(exact)).toBeNull();
    expect(formatSeriesCsv(exact)).toContain('aggregation exact');
    expect(formatSeriesCsv(exact)).not.toContain('WARNING');
  });
});

describe('formatSeriesJson', () => {
  it('includes the warning and serialises per-state counts as arrays', () => {
    const json = JSON.parse(formatSeriesJson(win())) as {
      warning: string | null;
      points: Array<{ perState: number[] }>;
    };
    expect(json.warning).toMatch(/downsampled/i);
    expect(json.points[0]?.perState).toEqual([0, 10]);
  });
});
