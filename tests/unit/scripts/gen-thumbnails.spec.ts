import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCatalogEntry } from '@engine/patterns/catalog';
import { decode } from '@shared/rle';
import { collectRleFiles } from '../../../scripts/check-pattern-licenses.mjs';
import {
  APERIODIC_GENERATIONS,
  encodeApng,
  encodePng,
  frameCountFor,
  generateThumbnails,
  isSpatiallyPeriodic,
  pixelsEqual,
  renderThumbnailFrames,
  THUMB_SIZE,
  thumbnailPayloadBytes,
  thumbnailTheme,
} from '../../../scripts/gen-thumbnails.mjs';

const PATTERNS = fileURLToPath(new URL('../../../patterns', import.meta.url));
const THUMBS = join(PATTERNS, 'thumbnails');

function load(id: string) {
  const text = readFileSync(join(PATTERNS, `${id}.rle`), 'utf8');
  return { entry: parseCatalogEntry(id, text), pattern: decode(text) };
}

describe('PNG / APNG codecs', () => {
  it('encodes a PNG that starts with the signature and is deterministic', () => {
    const px = new Uint8ClampedArray(THUMB_SIZE * THUMB_SIZE * 4);
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 16;
      px[i + 1] = 18;
      px[i + 2] = 22;
      px[i + 3] = 255;
    }
    const a = encodePng(px);
    const b = encodePng(px);
    expect(a.equals(b)).toBe(true);
    expect(a.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(a.includes(Buffer.from('IHDR'))).toBe(true);
    expect(a.includes(Buffer.from('IDAT'))).toBe(true);
  });

  it('encodes an APNG with acTL and one fdAT per extra frame', () => {
    const a = new Uint8ClampedArray(4).fill(255);
    const b = new Uint8ClampedArray([0, 0, 0, 255]);
    const bytes = encodeApng([a, b], 1, 1);
    expect(bytes.includes(Buffer.from('acTL'))).toBe(true);
    expect(bytes.includes(Buffer.from('fcTL'))).toBe(true);
    expect(bytes.includes(Buffer.from('fdAT'))).toBe(true);
    expect(encodeApng([a, b], 1, 1).equals(bytes)).toBe(true);
  });
});

describe('thumbnail camera and palette', () => {
  it('uses Default dark tokens as a greyscale ramp (no hue)', () => {
    const theme = thumbnailTheme();
    expect(theme.background).toMatch(/^#[0-9a-f]{6}$/);
    const s1 = theme.palette(1);
    const s2 = theme.palette(2);
    expect(s1).toMatch(/^#[0-9a-f]{6}$/);
    expect(s1).not.toBe(theme.background);
    expect(s2).not.toBe(s1);
    const hex = (h: string): [number, number, number] => [
      parseInt(h.slice(1, 3), 16),
      parseInt(h.slice(3, 5), 16),
      parseInt(h.slice(5, 7), 16),
    ];
    const [r, g, b] = hex(s1);
    expect(Math.abs(r - g)).toBeLessThanOrEqual(24);
    expect(Math.abs(g - b)).toBeLessThanOrEqual(24);
  });

  it('uses one period of frames for oscillators and 60 for methuselahs', () => {
    expect(frameCountFor({ category: 'oscillator', period: 15 })).toBe(15);
    expect(frameCountFor({ category: 'still-life', period: 1 })).toBe(1);
    expect(frameCountFor({ category: 'methuselah', period: null })).toBe(APERIODIC_GENERATIONS);
    expect(isSpatiallyPeriodic({ category: 'spaceship' })).toBe(true);
    expect(isSpatiallyPeriodic({ category: 'gun' })).toBe(false);
  });
});

describe('seamless loops (P2-B-2 AC3)', () => {
  it('blinker frame 0 equals the image after one period', async () => {
    const { entry, pattern } = load('blinker');
    const frames = await renderThumbnailFrames(entry, pattern);
    expect(frames.length).toBe(2);
    const again = await renderThumbnailFrames({ ...entry, period: 4 }, pattern);
    expect(pixelsEqual(again[0]!, again[2]!)).toBe(true);
  });

  it('glider (tracked spaceship) frame 0 equals frame period', async () => {
    const { entry, pattern } = load('glider');
    const frames = await renderThumbnailFrames({ ...entry, period: 8 }, pattern);
    expect(pixelsEqual(frames[0]!, frames[4]!)).toBe(true);
    expect(pixelsEqual(frames[0]!, frames[1]!)).toBe(false);
  });

  it('block still-life is a single stable frame', async () => {
    const { entry, pattern } = load('block');
    const frames = await renderThumbnailFrames(entry, pattern);
    expect(frames).toHaveLength(1);
    const twice = await renderThumbnailFrames({ ...entry, period: 2 }, pattern);
    expect(pixelsEqual(twice[0]!, twice[1]!)).toBe(true);
  });
});

describe('generateThumbnails', () => {
  it('running the generator twice produces byte-identical files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'gol-thumbs-'));
    const src = mkdtempSync(join(tmpdir(), 'gol-thumb-src-'));
    mkdirSync(src, { recursive: true });
    writeFileSync(join(src, 'blinker.rle'), readFileSync(join(PATTERNS, 'blinker.rle')));
    writeFileSync(join(src, 'glider.rle'), readFileSync(join(PATTERNS, 'glider.rle')));
    const a = join(dir, 'a');
    const b = join(dir, 'b');
    await generateThumbnails(src, a);
    await generateThumbnails(src, b);
    for (const name of ['blinker.png', 'blinker.apng', 'glider.png', 'glider.apng']) {
      expect(readFileSync(join(a, name)).equals(readFileSync(join(b, name))), name).toBe(true);
    }
  }, 30_000);

  it('committed catalogue thumbnails exist, stay under 3 MB, and cover every pattern', () => {
    const rles = collectRleFiles(PATTERNS);
    expect(rles.length).toBeGreaterThanOrEqual(40);
    for (const file of rles) {
      const id = file.slice(file.lastIndexOf('/') + 1, -'.rle'.length);
      const png = readFileSync(join(THUMBS, `${id}.png`));
      const apng = readFileSync(join(THUMBS, `${id}.apng`));
      expect(png[0]).toBe(137);
      expect(apng.includes(Buffer.from('acTL'))).toBe(true);
    }
    expect(thumbnailPayloadBytes(THUMBS)).toBeLessThan(3 * 1024 * 1024);
  });
});
