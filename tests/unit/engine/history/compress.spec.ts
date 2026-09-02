import { describe, expect, it } from 'vitest';
import { CHUNK_AREA, packChunk } from '@engine/grid/coords';
import {
  decodeChunkSet,
  encodeChunkSet,
  rleDecode,
  rleEncode,
} from '@engine/history/compress';
import { Mulberry32 } from '@engine/rng';

describe('rleEncode / rleDecode', () => {
  it('round-trips a mixed run and shrinks a dead page', () => {
    const src = Uint8Array.from([1, 1, 1, 0, 0, 2, 2, 2, 2]);
    const encoded = rleEncode(src);
    expect([...encoded]).toEqual([3, 1, 2, 0, 4, 2]);
    const dest = new Uint8Array(src.length);
    expect(rleDecode(encoded, dest)).toBe(src.length);
    expect(dest).toEqual(src);

    const dead = new Uint8Array(CHUNK_AREA);
    const deadRle = rleEncode(dead);
    expect(deadRle.length).toBeLessThan(dead.length);
    const back = new Uint8Array(CHUNK_AREA);
    rleDecode(deadRle, back);
    expect(back).toEqual(dead);
  });

  it('splits runs longer than 255', () => {
    const src = new Uint8Array(300);
    src.fill(7);
    const encoded = rleEncode(src);
    expect([...encoded]).toEqual([255, 7, 45, 7]);
    const dest = new Uint8Array(300);
    rleDecode(encoded, dest);
    expect(dest).toEqual(src);
  });

  it('refuses to overflow the destination', () => {
    expect(() => rleDecode(Uint8Array.from([8, 1]), new Uint8Array(4))).toThrow(/overflows/);
  });
});

describe('encodeChunkSet / decodeChunkSet', () => {
  it('tags a still-life page as RLE and a 50% soup as raw', () => {
    const keys = new Int32Array([packChunk(0, 0), packChunk(1, 0)]);
    const data = new Uint8Array(2 * CHUNK_AREA);
    data.fill(1, 0, CHUNK_AREA);
    const rng = new Mulberry32(0xc0ffee);
    for (let i = CHUNK_AREA; i < data.length; i++) data[i] = rng.next() < 0.5 ? 1 : 0;

    const encoded = encodeChunkSet(keys, data);
    const decoded = decodeChunkSet(encoded);
    expect(decoded.keys).toEqual(keys);
    expect(decoded.data).toEqual(data);

    const view = new DataView(encoded.buffer);
    const n = view.getUint32(0, true);
    expect(n).toBe(2);
    let o = 4 + n * 4;
    const len0 = view.getUint32(o, true);
    o += 4;
    expect(encoded[o]).toBe(1);
    expect(len0).toBeLessThan(1 + CHUNK_AREA);
    o += len0;
    const len1 = view.getUint32(o, true);
    o += 4;
    expect(encoded[o]).toBe(0);
    expect(len1).toBe(1 + CHUNK_AREA);
  });

  it('round-trips through a non-zero byteOffset subarray', () => {
    const keys = new Int32Array([packChunk(-1, 2)]);
    const data = new Uint8Array(CHUNK_AREA);
    data[17] = 3;
    const packed = encodeChunkSet(keys, data);
    const padded = new Uint8Array(packed.length + 16);
    padded.set(packed, 8);
    const decoded = decodeChunkSet(padded.subarray(8, 8 + packed.length));
    expect(decoded.keys).toEqual(keys);
    expect(decoded.data).toEqual(data);
  });

  it('rejects a data length that does not match the key count', () => {
    expect(() => encodeChunkSet(new Int32Array(2), new Uint8Array(8))).toThrow(/does not match/);
  });

  it('rejects an unknown page tag', () => {
    const keys = new Int32Array([0]);
    const data = new Uint8Array(CHUNK_AREA);
    const encoded = encodeChunkSet(keys, data);
    encoded[4 + 4 + 4] = 9;
    expect(() => decodeChunkSet(encoded)).toThrow(/unknown page tag/);
  });

  it('rejects a raw page whose body is the wrong length', () => {
    const out = new Uint8Array(4 + 4 + 4 + 1 + 8);
    const view = new DataView(out.buffer);
    view.setUint32(0, 1, true);
    view.setInt32(4, 0, true);
    view.setUint32(8, 9, true);
    out[12] = 0;
    expect(() => decodeChunkSet(out)).toThrow(/raw page length/);
  });

  it('rejects an RLE page that does not fill the destination', () => {
    const out = new Uint8Array(4 + 4 + 4 + 3);
    const view = new DataView(out.buffer);
    view.setUint32(0, 1, true);
    view.setInt32(4, 0, true);
    view.setUint32(8, 3, true);
    out[12] = 1;
    out[13] = 4;
    out[14] = 0;
    expect(() => decodeChunkSet(out)).toThrow(/expected/);
  });
});
