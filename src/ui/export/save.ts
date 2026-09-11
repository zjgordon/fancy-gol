/**
 * File save (P2-D-4). Prefer `showSaveFilePicker`; fall back to an anchor
 * download when the picker is missing or the user dismisses it.
 */

export interface SavePickerHandle {
  createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }>;
}

export type ShowSaveFilePicker = (opts: {
  suggestedName: string;
  types?: readonly { description: string; accept: Record<string, readonly string[]> }[];
}) => Promise<SavePickerHandle>;

export interface SaveBlobOptions {
  readonly showSaveFilePicker?: ShowSaveFilePicker | undefined;
  readonly download?: (blob: Blob, filename: string) => void;
}

function anchorDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export async function saveBlob(blob: Blob, filename: string, options: SaveBlobOptions = {}): Promise<void> {
  const picker =
    options.showSaveFilePicker ??
    (typeof window !== 'undefined'
      ? (window as unknown as { showSaveFilePicker?: ShowSaveFilePicker }).showSaveFilePicker
      : undefined);
  if (picker) {
    try {
      const handle = await picker({ suggestedName: filename });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return;
    }
  }
  (options.download ?? anchorDownload)(blob, filename);
}

export function blobFromText(text: string, type: string): Blob {
  return new Blob([text], { type });
}
