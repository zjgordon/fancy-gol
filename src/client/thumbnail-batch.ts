/**
 * Round-robin thumbnail stepping (P2-G-1). Stepping every 32×32 catalogue sim in one
 * frame blew the 2 ms budget; each tick steps only `batchSize` entries.
 */

export interface ThumbnailBatch {
  readonly indices: readonly number[];
  readonly nextOffset: number;
}

export const THUMBNAIL_WORLD_SIZE = 32;
export const THUMBNAIL_CANVAS_PX = 48;
export const THUMBNAIL_SEED_DENSITY = 0.3;
export const THUMBNAIL_STEP_EVERY_N_FRAMES = 30;
export const THUMBNAIL_BATCH_SIZE = 4;

/** Indices to step this tick, and the offset for the next rotating batch. */
export function thumbnailBatch(count: number, offset: number, batchSize: number): ThumbnailBatch {
  if (count <= 0 || batchSize <= 0) return { indices: [], nextOffset: 0 };
  const n = Math.min(batchSize, count);
  const indices: number[] = [];
  const start = ((offset % count) + count) % count;
  for (let i = 0; i < n; i++) indices.push((start + i) % count);
  return { indices, nextOffset: (start + batchSize) % count };
}

export function shouldStepThumbnails(frame: number, everyN: number): boolean {
  return everyN > 0 && frame % everyN === 0;
}
