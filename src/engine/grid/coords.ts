/**
 * Coordinate maths: chunk sizing (ADR-010), packing cell/chunk pairs into single integers
 * for use as Map keys and dense buffer entries, and boundary-mode normalisation.
 */

export const CHUNK_BITS = 5;
export const CHUNK_SIZE = 32; // 2 ** CHUNK_BITS
export const CHUNK_AREA = CHUNK_SIZE * CHUNK_SIZE; // 1024
const CHUNK_MASK = CHUNK_SIZE - 1; // 31

/**
 * The addressable range of "infinite" mode: ±1,048,576 cells per axis (ADR-010). This is
 * `chunkCoordLimit (2**16 / 2) * CHUNK_SIZE` — the largest chunk coordinate a packed,
 * signed-16-bit chunk key can represent, times the chunk size. Documented as a real limit,
 * not an implied one: "Infinite" is not infinite, and we say so.
 */
export const WORLD_LIMIT = 32_768 * CHUNK_SIZE; // 1,048,576

/**
 * Pack a cell coordinate pair into one signed 32-bit int (two signed 16-bit halves).
 * Only meaningful for `|x|, |y| <= 32767` — callers needing the full `WORLD_LIMIT` range
 * address cells via `packChunk` + `localIndex` instead.
 */
export function packCell(x: number, y: number): number {
  return ((x & 0xffff) << 16) | (y & 0xffff);
}

export function unpackCellX(packed: number): number {
  return packed >> 16;
}

export function unpackCellY(packed: number): number {
  return (packed << 16) >> 16;
}

/** Pack a chunk coordinate pair the same way (ADR-010's `key` function). */
export function packChunk(cx: number, cy: number): number {
  return ((cx & 0xffff) << 16) | (cy & 0xffff);
}

export function unpackChunkX(key: number): number {
  return key >> 16;
}

export function unpackChunkY(key: number): number {
  return (key << 16) >> 16;
}

/** Which chunk a cell coordinate falls in. Floors toward -Infinity for negative input. */
export function worldToChunk(x: number, y: number): readonly [cx: number, cy: number] {
  return [x >> CHUNK_BITS, y >> CHUNK_BITS];
}

/** The world coordinate of a chunk's top-left cell. */
export function chunkToWorld(cx: number, cy: number): readonly [x: number, y: number] {
  return [cx * CHUNK_SIZE, cy * CHUNK_SIZE];
}

/** A cell's index within its chunk's flat `Uint8Array(1024)`. */
export function localIndex(x: number, y: number): number {
  return ((y & CHUNK_MASK) << CHUNK_BITS) | (x & CHUNK_MASK);
}

/**
 * Resolve a cell coordinate against a boundary mode.
 * - `toroidal` wraps into `[0, width) x [0, height)`.
 * - `bounded` returns `null` for anything outside `[0, width) x [0, height)`.
 * - `infinite` returns the coordinate unchanged, throwing if it exceeds `WORLD_LIMIT`.
 */
export function normalize(
  x: number,
  y: number,
  boundary: 'bounded' | 'toroidal' | 'infinite',
  width: number,
  height: number,
): readonly [x: number, y: number] | null {
  if (boundary === 'infinite') {
    if (Math.abs(x) > WORLD_LIMIT || Math.abs(y) > WORLD_LIMIT) {
      throw new RangeError(
        `Coordinate (${x}, ${y}) exceeds the world limit of ±${WORLD_LIMIT} cells per axis`,
      );
    }
    return [x, y];
  }
  if (boundary === 'toroidal') {
    return [((x % width) + width) % width, ((y % height) + height) % height];
  }
  return x >= 0 && x < width && y >= 0 && y < height ? [x, y] : null;
}

/**
 * True when `(x, y)` is the representative coordinate a cell is stored at.
 * - `bounded`: inside `[0, width) × [0, height)`.
 * - `toroidal`: the same, *after* wrapping — so `(width, 0)` is not canonical.
 * - `infinite`: always, provided `normalize` does not throw.
 *
 * A 32×32 chunk page may cover cells that fail this test when the world is not a
 * multiple of {@link CHUNK_SIZE}. Those slots are ghosts: never stored, never read
 * as neighbours (use {@link normalize} / `read` instead).
 */
export function isCanonicalCell(
  x: number,
  y: number,
  boundary: 'bounded' | 'toroidal' | 'infinite',
  width: number,
  height: number,
): boolean {
  const n = normalize(x, y, boundary, width, height);
  return n !== null && n[0] === x && n[1] === y;
}

/**
 * True when every cell of the 32×32 page whose top-left is `(ox, oy)` is canonical.
 * The lut8 inner loop may memcpy that page; otherwise each neighbour must go
 * through {@link normalize} (ADR-010: boundaries are not checked in the inner loop
 * of a fully-contained page).
 */
export function chunkFitsWorld(
  ox: number,
  oy: number,
  boundary: 'bounded' | 'toroidal' | 'infinite',
  width: number,
  height: number,
): boolean {
  if (boundary === 'infinite') return true;
  return ox >= 0 && oy >= 0 && ox + CHUNK_SIZE <= width && oy + CHUNK_SIZE <= height;
}
