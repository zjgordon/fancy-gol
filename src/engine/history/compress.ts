/**
 * Chunk-set RLE for history keyframes. A run-length pass over each 32×32 page
 * beats a generic compressor for CA data (long dead runs, still-life blocks) and
 * costs no dependency. Pages that do not shrink stay raw, tagged, so a 50% soup
 * never pays a 2× expansion.
 */
import { CHUNK_AREA } from '../grid/coords';

const TAG_RAW = 0;
const TAG_RLE = 1;

/** Encode `src` as `[count, value, …]` pairs, counts in `1..255`. */
export function rleEncode(src: Uint8Array): Uint8Array {
  const out: number[] = [];
  let i = 0;
  while (i < src.length) {
    const value = src[i]!;
    let count = 1;
    i += 1;
    while (i < src.length && src[i] === value && count < 255) {
      count += 1;
      i += 1;
    }
    out.push(count, value);
  }
  return Uint8Array.from(out);
}

/** Decode RLE pairs into `dest` (must be large enough). Returns bytes written. */
export function rleDecode(encoded: Uint8Array, dest: Uint8Array): number {
  let di = 0;
  for (let i = 0; i + 1 < encoded.length; i += 2) {
    const count = encoded[i]!;
    const value = encoded[i + 1]!;
    if (di + count > dest.length) {
      throw new RangeError('RLE decode overflows destination');
    }
    dest.fill(value, di, di + count);
    di += count;
  }
  return di;
}

function encodePage(page: Uint8Array): Uint8Array {
  const rle = rleEncode(page);
  if (rle.length < page.length) {
    const out = new Uint8Array(1 + rle.length);
    out[0] = TAG_RLE;
    out.set(rle, 1);
    return out;
  }
  const out = new Uint8Array(1 + page.length);
  out[0] = TAG_RAW;
  out.set(page, 1);
  return out;
}

function decodePage(encoded: Uint8Array, dest: Uint8Array): void {
  const tag = encoded[0];
  const body = encoded.subarray(1);
  if (tag === TAG_RAW) {
    if (body.length !== dest.length) {
      throw new RangeError(`raw page length ${body.length} != ${dest.length}`);
    }
    dest.set(body);
    return;
  }
  if (tag === TAG_RLE) {
    const written = rleDecode(body, dest);
    if (written !== dest.length) {
      throw new RangeError(`RLE page decoded ${written} bytes, expected ${dest.length}`);
    }
    return;
  }
  throw new RangeError(`unknown page tag ${tag}`);
}

/**
 * Pack a snapshot's live pages into one buffer: key count, keys, then each page
 * as `[u32 length][tagged bytes]`.
 */
export function encodeChunkSet(keys: Int32Array, data: Uint8Array): Uint8Array {
  const n = keys.length;
  if (data.length !== n * CHUNK_AREA) {
    throw new RangeError(
      `chunk data length ${data.length} does not match ${n} pages of ${CHUNK_AREA}`,
    );
  }
  const pages: Uint8Array[] = [];
  let body = 0;
  for (let i = 0; i < n; i++) {
    const page = encodePage(data.subarray(i * CHUNK_AREA, (i + 1) * CHUNK_AREA));
    pages.push(page);
    body += 4 + page.length;
  }
  const out = new Uint8Array(4 + n * 4 + body);
  const view = new DataView(out.buffer);
  view.setUint32(0, n, true);
  let o = 4;
  for (let i = 0; i < n; i++) {
    view.setInt32(o, keys[i]!, true);
    o += 4;
  }
  for (const page of pages) {
    view.setUint32(o, page.length, true);
    o += 4;
    out.set(page, o);
    o += page.length;
  }
  return out;
}

export function decodeChunkSet(encoded: Uint8Array): {
  keys: Int32Array;
  data: Uint8Array;
} {
  const view = new DataView(encoded.buffer, encoded.byteOffset, encoded.byteLength);
  const n = view.getUint32(0, true);
  const keys = new Int32Array(n);
  let o = 4;
  for (let i = 0; i < n; i++) {
    keys[i] = view.getInt32(o, true);
    o += 4;
  }
  const data = new Uint8Array(n * CHUNK_AREA);
  for (let i = 0; i < n; i++) {
    const len = view.getUint32(o, true);
    o += 4;
    decodePage(encoded.subarray(o, o + len), data.subarray(i * CHUNK_AREA, (i + 1) * CHUNK_AREA));
    o += len;
  }
  return { keys, data };
}
