/**
 * Export dialog (P2-D-4). One place for series CSV/JSON, 2× chart PNGs,
 * grid or selection RLE, and a PNG of the live view.
 */
import { openDialog } from '@ui/components/dialog';
import type { ChartWindow } from '@ui/charts/chart';
import { formatSeriesCsv, formatSeriesJson, seriesExportWarning } from './format';
import { CHART_EXPORT_SCALE } from './png';
import { blobFromText, saveBlob, type SaveBlobOptions } from './save';

export interface ExportDialogSource {
  series(): Promise<ChartWindow | null>;
  charts(): Promise<readonly { name: string; blob: Blob }[]>;
  gridRle(): string;
  selectionRle(): string | null;
  viewPng(): Promise<Blob>;
  readonly save?: SaveBlobOptions;
}

function action(label: string, hint: string, run: () => void | Promise<void>): HTMLElement {
  const row = document.createElement('div');
  row.className = 'export-row';
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.textContent = label;
  const note = document.createElement('p');
  note.className = 'export-hint';
  note.textContent = hint;
  btn.addEventListener('click', () => {
    void run();
  });
  row.append(btn, note);
  return row;
}

export function openExportDialog(source: ExportDialogSource): void {
  const handle = openDialog({ title: 'Export' });
  handle.panel.classList.add('dialog-panel-wide');
  const list = document.createElement('div');
  list.className = 'export-list';
  const save = source.save ?? {};

  list.append(
    action('Statistics CSV', 'Full retained series. Downsampled columns are labelled in the header.', async () => {
      const win = await source.series();
      if (!win) return;
      await saveBlob(blobFromText(formatSeriesCsv(win), 'text/csv;charset=utf-8'), 'fancy-gol-stats.csv', save);
    }),
    action('Statistics JSON', 'Same series as CSV, with a warning field when approximated.', async () => {
      const win = await source.series();
      if (!win) return;
      await saveBlob(blobFromText(formatSeriesJson(win), 'application/json'), 'fancy-gol-stats.json', save);
    }),
    action(`Charts PNG (${CHART_EXPORT_SCALE}×)`, 'Each open chart redrawn at 2× — pixel-crisp, not stretched.', async () => {
      const charts = await source.charts();
      for (const chart of charts) {
        await saveBlob(chart.blob, `fancy-gol-${chart.name}@${CHART_EXPORT_SCALE}x.png`, save);
      }
    }),
    action('Grid RLE', 'Every live cell on the current grid.', async () => {
      await saveBlob(blobFromText(source.gridRle(), 'text/plain'), 'fancy-gol-grid.rle', save);
    }),
    action('Selection RLE', 'The current marquee, if one is selected.', async () => {
      const rle = source.selectionRle();
      if (!rle) return;
      await saveBlob(blobFromText(rle, 'text/plain'), 'fancy-gol-selection.rle', save);
    }),
    action('View PNG', 'The grid as you see it right now.', async () => {
      await saveBlob(await source.viewPng(), 'fancy-gol-view.png', save);
    }),
  );

  handle.panel.append(list);
}

export function describeExportAvailability(win: ChartWindow | null): string {
  if (!win) return 'No statistics window yet.';
  return seriesExportWarning(win) ?? win.label;
}
