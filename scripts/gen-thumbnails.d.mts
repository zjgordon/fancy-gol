export const THUMB_SIZE: number;
export const APERIODIC_GENERATIONS: number;
export const PAD_CELLS: number;
export const FRAME_DELAY_NUM: number;
export const FRAME_DELAY_DEN: number;

export function encodePng(rgba: Uint8ClampedArray | Uint8Array, width?: number, height?: number): Buffer;
export function encodeApng(
  frames: ReadonlyArray<Uint8ClampedArray | Uint8Array>,
  width?: number,
  height?: number,
): Buffer;
export function thumbnailTheme(): { id: string; background: string; palette: (state: number) => string };
export function frameCountFor(entry: { category: string; period: number | null }): number;
export function isSpatiallyPeriodic(entry: { category: string }): boolean;
export function renderThumbnailFrames(
  entry: {
    id: string;
    ruleset: string;
    category: string;
    period: number | null;
  },
  pattern: { cells: ReadonlyArray<{ x: number; y: number; state: number }> },
): Promise<Uint8ClampedArray[]>;
export function renderEntry(
  entry: {
    id: string;
    ruleset: string;
    category: string;
    period: number | null;
  },
  pattern: { cells: ReadonlyArray<{ x: number; y: number; state: number }> },
): Promise<{ frames: Uint8ClampedArray[]; png: Buffer; apng: Buffer }>;
export function defaultPatternsDir(): string;
export function defaultOutDir(): string;
export function generateThumbnails(patternsDir?: string, outDir?: string): Promise<string[]>;
export function thumbnailPayloadBytes(dir: string): number;
export function pixelsEqual(a: ArrayLike<number>, b: ArrayLike<number>): boolean;
