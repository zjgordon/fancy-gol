import { afterEach, describe, expect, it } from 'vitest';
import type { StatsWindowPoint } from '@shared/protocol';
import type { ChartWindow } from '@ui/charts/chart';
import { openExportDialog } from '@ui/export/dialog';

function win(): ChartWindow {
  const p: StatsWindowPoint = {
    tick: 0,
    population: 4,
    populationMin: 4,
    populationMax: 4,
    perState: Uint32Array.from([0, 4]),
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
    density: 0.1,
    bbox: { x: 0, y: 0, width: 2, height: 2 },
    centroid: { x: 1, y: 1 },
    entropy: 0,
    hash: 1,
    tier: 0,
  };
  return {
    points: [p],
    tier: 0,
    aggregated: false,
    downsampled: false,
    sourceCount: 1,
    label: 'Tier 0 (every tick)',
  };
}

describe('openExportDialog', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('offers series, charts, grid, selection, and view exports', async () => {
    const saved: string[] = [];
    openExportDialog({
      series: () => Promise.resolve(win()),
      charts: () => Promise.resolve([{ name: 'population', blob: new Blob(['png'], { type: 'image/png' }) }]),
      gridRle: () => 'x = 2, y = 2\n2o$2o!',
      selectionRle: () => 'x = 1, y = 1\no!',
      viewPng: () => Promise.resolve(new Blob(['view'], { type: 'image/png' })),
      save: {
        download: (_blob, name) => {
          saved.push(name);
        },
      },
    });
    const labels = [...document.querySelectorAll('.export-row button')].map((b) => b.textContent);
    expect(labels).toEqual(
      expect.arrayContaining([
        'Statistics CSV',
        'Statistics JSON',
        'Charts PNG (2×)',
        'Grid RLE',
        'Selection RLE',
        'View PNG',
      ]),
    );
    const csv = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Statistics CSV');
    csv?.click();
    await Promise.resolve();
    await Promise.resolve();
    expect(saved).toContain('fancy-gol-stats.csv');
  });
});
