/**
 * Statistics series export (P2-D-4). CSV and JSON of a `statsWindow` reply.
 * Downsampled or aggregated columns are labelled in the header — never presented
 * as exact. Decimals always use an ASCII period so a spreadsheet in any locale
 * reads the same numbers.
 */
import type { StatsWindowPoint } from '@shared/protocol';
import type { ChartWindow } from '@ui/charts/chart';

export const CSV_DECIMAL = '.';

const TIER_AGG: Record<0 | 1 | 2 | 3, string> = {
  0: 'exact (every tick)',
  1: 'min/mean/max every 16 ticks',
  2: 'min/mean/max every 256 ticks',
  3: 'min/mean/max every 4,096 ticks',
};

export function formatExportNumber(value: number): string {
  if (!Number.isFinite(value)) return '';
  if (Number.isInteger(value)) return String(value);
  return value.toString();
}

function aggregationFor(win: ChartWindow, field: 'mean' | 'envelope' | 'sample'): string {
  if (win.tier === 0 && !win.aggregated && !win.downsampled) return 'exact';
  const parts: string[] = [TIER_AGG[win.tier]];
  if (field === 'envelope' && win.aggregated) parts.push('min/max envelope');
  if (field === 'mean' && win.aggregated) parts.push('mean of bucket');
  if (win.downsampled) parts.push(`LTTB to ${win.points.length} points`);
  return parts.join('; ');
}

export function seriesExportWarning(win: ChartWindow): string | null {
  if (!win.aggregated && !win.downsampled && win.tier === 0) return null;
  return `WARNING: downsampled or aggregated — not an exact tick-by-tick record. ${win.label}`;
}

function columnMeta(win: ChartWindow): readonly { name: string; aggregation: string }[] {
  const exact = aggregationFor(win, 'sample');
  const mean = aggregationFor(win, 'mean');
  const envelope = aggregationFor(win, 'envelope');
  return [
    { name: 'tick', aggregation: 'exact' },
    { name: 'population', aggregation: mean },
    { name: 'population_min', aggregation: envelope },
    { name: 'population_max', aggregation: envelope },
    { name: 'births', aggregation: exact },
    { name: 'deaths', aggregation: exact },
    { name: 'transitions', aggregation: exact },
    { name: 'activity', aggregation: exact },
    { name: 'density', aggregation: exact },
    { name: 'entropy', aggregation: exact },
    { name: 'hash', aggregation: 'exact' },
    { name: 'bbox_x', aggregation: exact },
    { name: 'bbox_y', aggregation: exact },
    { name: 'bbox_width', aggregation: exact },
    { name: 'bbox_height', aggregation: exact },
    { name: 'centroid_x', aggregation: exact },
    { name: 'centroid_y', aggregation: exact },
    { name: 'tier', aggregation: 'metadata' },
  ];
}

function rowOf(p: StatsWindowPoint): readonly number[] {
  return [
    p.tick,
    p.population,
    p.populationMin,
    p.populationMax,
    p.births,
    p.deaths,
    p.transitions,
    p.activity,
    p.density,
    p.entropy,
    p.hash,
    p.bbox.x,
    p.bbox.y,
    p.bbox.width,
    p.bbox.height,
    p.centroid.x,
    p.centroid.y,
    p.tier,
  ];
}

export function formatSeriesCsv(win: ChartWindow): string {
  const cols = columnMeta(win);
  const warning = seriesExportWarning(win);
  const lines: string[] = [
    '# fancy-gol statistics export',
    `# window: ${win.label}`,
    `# tier: ${win.tier}`,
    `# aggregated: ${win.aggregated}`,
    `# downsampled: ${win.downsampled}`,
    `# source_count: ${win.sourceCount}`,
    `# decimal: ASCII period (${CSV_DECIMAL}) — locale-independent`,
  ];
  if (warning) lines.push(`# ${warning}`);
  for (const col of cols) {
    lines.push(`# column ${col.name}: tier ${win.tier}; aggregation ${col.aggregation}`);
  }
  lines.push(cols.map((c) => c.name).join(','));
  for (const p of win.points) {
    lines.push(rowOf(p).map(formatExportNumber).join(','));
  }
  return lines.join('\n') + '\n';
}

export function formatSeriesJson(win: ChartWindow): string {
  const warning = seriesExportWarning(win);
  const body = {
    label: win.label,
    tier: win.tier,
    aggregated: win.aggregated,
    downsampled: win.downsampled,
    sourceCount: win.sourceCount,
    warning,
    columns: columnMeta(win),
    points: win.points.map((p) => ({
      tick: p.tick,
      population: p.population,
      populationMin: p.populationMin,
      populationMax: p.populationMax,
      births: p.births,
      deaths: p.deaths,
      transitions: p.transitions,
      activity: p.activity,
      density: p.density,
      entropy: p.entropy,
      hash: p.hash,
      bbox: p.bbox,
      centroid: p.centroid,
      perState: [...p.perState],
      tier: p.tier,
    })),
  };
  return `${JSON.stringify(body, null, 2)}\n`;
}
