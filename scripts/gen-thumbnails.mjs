#!/usr/bin/env node
/**
 * gen-thumbnails.mjs — P2-B-2. Headless library thumbnails from the real engine and
 * CanvasRecorder (the P0-H-3 rasteriser), not a second renderer.
 *
 * Architecture 2.1 lists APNG/WebP; this script emits a static PNG poster plus an animated
 * APNG. VP8 WebP is not fifty lines of TypeScript and would need a new encoder dependency —
 * APNG is zlib (already in Node) plus PNG chunks, deterministic, and loops in every browser
 * the client already targets.
 *
 * Theme-neutral: Default dark tokens, chroma stripped — greyscale so the same file reads on
 * every future theme. 128×128. Periodic patterns use one period of frames (camera locked, or
 * bbox-tracked for spaceships so gen 0 === gen `period`). Aperiodic patterns use 60 gens.
 *
 *   node --import tsx scripts/gen-thumbnails.mjs
 *   node --import tsx scripts/gen-thumbnails.mjs --out /tmp/thumbs
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { parseCatalogEntry } from '../src/engine/patterns/catalog.ts';
import { getBuiltin } from '../src/engine/rules/builtin/index.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { Canvas2DRenderer } from '../src/render/canvas2d.ts';
import { CanvasRecorder } from '../src/render/recorder.ts';
import { CHUNK_SIZE, chunkToWorld, localIndex } from '../src/shared/types.ts';
import { parseCssColor, toHex } from '../src/shared/color.ts';
import { decode } from '../src/shared/rle.ts';
import { DEFAULT_DARK_TOKENS } from '../src/themes/default/tokens.ts';
import { collectRleFiles } from './check-pattern-licenses.mjs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

export const THUMB_SIZE = 128;
export const APERIODIC_GENERATIONS = 60;
export const PAD_CELLS = 1;
export const FRAME_DELAY_NUM = 8;
export const FRAME_DELAY_DEN = 100; // 80 ms
const CELL_SIZES = [64, 32, 16, 8, 4, 2, 1];

const PNG_SIG = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32BE(n >>> 0);
  return b;
}

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16BE(n & 0xffff);
  return b;
}

function pngChunk(type, data) {
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([u32(data.length), body, crc]);
}

function ihdr(width, height) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(width, 0);
  data.writeUInt32BE(height, 4);
  data[8] = 8;
  data[9] = 6; // RGBA
  return pngChunk('IHDR', data);
}

function deflateRgba(rgba, width, height) {
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + y * stride, stride).copy(raw, y * (stride + 1) + 1);
  }
  return deflateSync(raw, { level: 9 });
}

/** Lossless PNG, filter-None + zlib level 9 — byte-identical across runs on the same pixels. */
export function encodePng(rgba, width = THUMB_SIZE, height = THUMB_SIZE) {
  return Buffer.concat([PNG_SIG, ihdr(width, height), pngChunk('IDAT', deflateRgba(rgba, width, height)), pngChunk('IEND', Buffer.alloc(0))]);
}

function fctl(seq, width, height) {
  const data = Buffer.concat([
    u32(seq),
    u32(width),
    u32(height),
    u32(0),
    u32(0),
    u16(FRAME_DELAY_NUM),
    u16(FRAME_DELAY_DEN),
    Buffer.from([0, 0]), // dispose none, blend source
  ]);
  return pngChunk('fcTL', data);
}

/**
 * Animated PNG (APNG). Frame 0 is the default image; subsequent frames are fdAT.
 * `num_plays = 0` loops forever. Periodic patterns pass frames `[0, period)`.
 */
export function encodeApng(frames, width = THUMB_SIZE, height = THUMB_SIZE) {
  if (frames.length === 0) throw new RangeError('encodeApng: no frames');
  const parts = [PNG_SIG, ihdr(width, height)];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4);
  parts.push(pngChunk('acTL', actl));
  let seq = 0;
  for (let i = 0; i < frames.length; i++) {
    parts.push(fctl(seq++, width, height));
    const deflated = deflateRgba(frames[i], width, height);
    if (i === 0) parts.push(pngChunk('IDAT', deflated));
    else parts.push(pngChunk('fdAT', Buffer.concat([u32(seq++), deflated])));
  }
  parts.push(pngChunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}

function requireRgb(hex, label) {
  const c = parseCssColor(hex);
  if (!c) throw new Error(`unreadable ${label} token "${hex}"`);
  return { r: c.r, g: c.g, b: c.b };
}

function lerpByte(a, b, t) {
  return Math.round(a + (b - a) * t);
}

/** Greyscale ramp from Default dark tokens — no hue, so it survives every theme. */
export function thumbnailTheme() {
  const bg = requireRgb(DEFAULT_DARK_TOKENS.color.bg, 'bg');
  const muted = requireRgb(DEFAULT_DARK_TOKENS.color.muted, 'muted');
  const text = requireRgb(DEFAULT_DARK_TOKENS.color.text, 'text');
  const background = toHex(bg);
  return {
    id: 'thumbnail-grey',
    background,
    palette: (state) => {
      if (state === 0) return background;
      const t = Math.min(1, (state - 1) / 7);
      return toHex({
        r: lerpByte(muted.r, text.r, t),
        g: lerpByte(muted.g, text.g, t),
        b: lerpByte(muted.b, text.b, t),
      });
    },
  };
}

export function frameCountFor(entry) {
  if (entry.category === 'still-life' || entry.category === 'oscillator' || entry.category === 'spaceship') {
    return Math.max(1, entry.period ?? 1);
  }
  if (entry.category === 'gun' && entry.period && entry.period > 0) return entry.period;
  return APERIODIC_GENERATIONS;
}

export function isSpatiallyPeriodic(entry) {
  return entry.category === 'still-life' || entry.category === 'oscillator' || entry.category === 'spaceship';
}

function collectLive(sim) {
  const cells = [];
  const b = sim.bounds();
  if (b.width <= 0 || b.height <= 0) return cells;
  sim.view().forEachChunkInRect(b, (chunk) => {
    const [ox, oy] = chunkToWorld(chunk.cx, chunk.cy);
    for (let ly = 0; ly < CHUNK_SIZE; ly++) {
      for (let lx = 0; lx < CHUNK_SIZE; lx++) {
        const state = chunk.at(localIndex(lx, ly));
        if (state !== 0) cells.push({ x: ox + lx, y: oy + ly, state });
      }
    }
  });
  return cells;
}

function bboxOf(cells) {
  if (cells.length === 0) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return { minX, minY, maxX, maxY };
}

function pickCellSize(need) {
  const maxCs = Math.max(1, Math.floor(THUMB_SIZE / Math.max(1, need)));
  for (const d of CELL_SIZES) {
    if (d <= maxCs) return d;
  }
  return 1;
}

function cameraFor(box, cellSize) {
  const vis = THUMB_SIZE / cellSize;
  const w = box.maxX - box.minX + 1;
  const h = box.maxY - box.minY + 1;
  return {
    originX: box.minX - Math.floor((vis - w) / 2),
    originY: box.minY - Math.floor((vis - h) / 2),
    cellSize,
    widthPx: THUMB_SIZE,
    heightPx: THUMB_SIZE,
    dpr: 1,
  };
}

function unionBox(boxes) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of boxes) {
    if (b.minX < minX) minX = b.minX;
    if (b.minY < minY) minY = b.minY;
    if (b.maxX > maxX) maxX = b.maxX;
    if (b.maxY > maxY) maxY = b.maxY;
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

function padded(box) {
  return {
    minX: box.minX - PAD_CELLS,
    minY: box.minY - PAD_CELLS,
    maxX: box.maxX + PAD_CELLS,
    maxY: box.maxY + PAD_CELLS,
  };
}

function makeCanvas() {
  const recorder = new CanvasRecorder(THUMB_SIZE, THUMB_SIZE);
  const canvas = {
    width: THUMB_SIZE,
    height: THUMB_SIZE,
    style: { width: `${THUMB_SIZE}px`, height: `${THUMB_SIZE}px` },
    getContext(kind) {
      return kind === '2d' ? recorder : null;
    },
  };
  return { canvas, recorder };
}

/**
 * Simulate `count` generations (inclusive of gen 0) and rasterise each with the real
 * Canvas2DRenderer. Spaceships are bbox-tracked so a translated copy still loops; everything
 * else uses a fixed camera over the union bbox.
 */
export async function renderThumbnailFrames(entry, pattern) {
  const rs = getBuiltin(entry.ruleset);
  if (!rs) throw new Error(`${entry.id}: unknown ruleset ${entry.ruleset}`);
  const sim = new Simulation({ ruleset: { ...rs, boundary: 'infinite' } });
  for (const cell of pattern.cells) {
    if (cell.state !== 0) sim.set(cell.x, cell.y, cell.state);
  }

  const count = frameCountFor(entry);
  const liveFrames = [];
  for (let i = 0; i < count; i++) {
    liveFrames.push(collectLive(sim));
    if (i < count - 1) sim.step();
  }

  const follow = entry.category === 'spaceship';
  const boxes = liveFrames.map((cells) => padded(bboxOf(cells)));
  const scaleBox = follow
    ? boxes.reduce(
        (acc, b) => ({
          minX: 0,
          minY: 0,
          maxX: Math.max(acc.maxX, b.maxX - b.minX),
          maxY: Math.max(acc.maxY, b.maxY - b.minY),
        }),
        { minX: 0, minY: 0, maxX: 0, maxY: 0 },
      )
    : unionBox(boxes);
  const cellSize = pickCellSize(Math.max(scaleBox.maxX - scaleBox.minX + 1, scaleBox.maxY - scaleBox.minY + 1));
  const fixedCam = follow ? null : cameraFor(scaleBox, cellSize);

  const { canvas, recorder } = makeCanvas();
  const renderer = new Canvas2DRenderer();
  await renderer.init(canvas);
  renderer.setTheme(thumbnailTheme());
  renderer.resize(THUMB_SIZE, THUMB_SIZE, 1);

  const frames = [];
  for (let i = 0; i < liveFrames.length; i++) {
    const cam = follow ? cameraFor(boxes[i], cellSize) : fixedCam;
    renderer.setViewport(cam);
    // Replay this generation's cells onto a fresh sim view — we already stepped. Draw from
    // the live Simulation at gen i by restoring… cheaper: temporarily we kept only coords.
    // Re-draw using a one-shot overlay grid: step a dedicated renderer sim instead.
    renderer.draw({ cells: overlayView(liveFrames[i]), dirty: null, tick: i });
    frames.push(recorder.snapshot());
    recorder.resetLog();
  }
  renderer.dispose();
  return frames;
}

/** Minimal GridView over a sparse live-cell list so we can draw a recorded generation. */
function overlayView(cells) {
  const map = new Map();
  let minX = 0;
  let minY = 0;
  let maxX = 0;
  let maxY = 0;
  if (cells.length > 0) {
    minX = maxX = cells[0].x;
    minY = maxY = cells[0].y;
  }
  for (const c of cells) {
    map.set(`${c.x},${c.y}`, c.state);
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  const bounds = { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 };
  return {
    boundary: 'infinite',
    get: (x, y) => map.get(`${x},${y}`) ?? 0,
    bounds: () => bounds,
    getChunk: () => undefined,
    forEachChunkInRect: (rect, fn) => {
      const cx0 = Math.floor(rect.x / CHUNK_SIZE);
      const cy0 = Math.floor(rect.y / CHUNK_SIZE);
      const cx1 = Math.floor((rect.x + rect.width - 1) / CHUNK_SIZE);
      const cy1 = Math.floor((rect.y + rect.height - 1) / CHUNK_SIZE);
      for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
          const ox = cx * CHUNK_SIZE;
          const oy = cy * CHUNK_SIZE;
          let pop = 0;
          const data = new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
          for (let ly = 0; ly < CHUNK_SIZE; ly++) {
            for (let lx = 0; lx < CHUNK_SIZE; lx++) {
              const s = map.get(`${ox + lx},${oy + ly}`) ?? 0;
              if (s) {
                data[ly * CHUNK_SIZE + lx] = s;
                pop += 1;
              }
            }
          }
          if (pop === 0) continue;
          fn({
            cx,
            cy,
            population: pop,
            at: (i) => data[i] ?? 0,
          });
        }
      }
    },
  };
}

export async function renderEntry(entry, pattern) {
  const frames = await renderThumbnailFrames(entry, pattern);
  return {
    frames,
    png: encodePng(frames[0]),
    apng: encodeApng(frames),
  };
}

export function pixelsEqual(a, b) {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

export function defaultPatternsDir() {
  return join(ROOT, 'patterns');
}

export function defaultOutDir() {
  return join(ROOT, 'patterns', 'thumbnails');
}

export async function generateThumbnails(patternsDir = defaultPatternsDir(), outDir = defaultOutDir()) {
  mkdirSync(outDir, { recursive: true });
  const files = collectRleFiles(patternsDir).sort();
  const written = [];
  for (const file of files) {
    const id = basename(file, '.rle');
    const text = readFileSync(file, 'utf8');
    const entry = parseCatalogEntry(id, text);
    const pattern = decode(text);
    const { png, apng } = await renderEntry(entry, pattern);
    const pngPath = join(outDir, `${id}.png`);
    const apngPath = join(outDir, `${id}.apng`);
    writeFileSync(pngPath, png);
    writeFileSync(apngPath, apng);
    written.push(pngPath, apngPath);
  }
  return written;
}

export function thumbnailPayloadBytes(dir) {
  if (!existsSync(dir)) return 0;
  let total = 0;
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isFile() && (name.endsWith('.png') || name.endsWith('.apng'))) total += st.size;
  }
  return total;
}

function parseArgs(argv) {
  let out = defaultOutDir();
  let patterns = defaultPatternsDir();
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--out') out = argv[++i];
    else if (argv[i] === '--patterns') patterns = argv[++i];
  }
  return { out, patterns };
}

async function main() {
  const { out, patterns } = parseArgs(process.argv.slice(2));
  rmSync(out, { recursive: true, force: true });
  const written = await generateThumbnails(patterns, out);
  const bytes = thumbnailPayloadBytes(out);
  console.log(`✓ ${written.length / 2} thumbnails → ${out} (${(bytes / 1024).toFixed(1)} KiB)`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
