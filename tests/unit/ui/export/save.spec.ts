import { afterEach, describe, expect, it, vi } from 'vitest';
import { blobFromText, saveBlob } from '@ui/export/save';

describe('saveBlob', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes through showSaveFilePicker when the picker resolves', async () => {
    const written: Blob[] = [];
    const picker = vi.fn(() =>
      Promise.resolve({
        createWritable: () =>
          Promise.resolve({
            write: (data: Blob) => {
              written.push(data);
              return Promise.resolve();
            },
            close: () => Promise.resolve(),
          }),
      }),
    );
    const blob = blobFromText('hello', 'text/plain');
    await saveBlob(blob, 'out.csv', { showSaveFilePicker: picker });
    expect(picker).toHaveBeenCalledWith(expect.objectContaining({ suggestedName: 'out.csv' }));
    expect(written).toEqual([blob]);
  });

  it('falls back to an anchor download when the picker is missing', async () => {
    const download = vi.fn();
    const blob = blobFromText('x', 'text/csv');
    await saveBlob(blob, 'stats.csv', { download });
    expect(download).toHaveBeenCalledWith(blob, 'stats.csv');
  });

  it('does not download when the user aborts the picker', async () => {
    const download = vi.fn();
    const picker = () => Promise.reject(new DOMException('dismissed', 'AbortError'));
    await saveBlob(blobFromText('x', 'text/plain'), 'n.csv', { showSaveFilePicker: picker, download });
    expect(download).not.toHaveBeenCalled();
  });
});
