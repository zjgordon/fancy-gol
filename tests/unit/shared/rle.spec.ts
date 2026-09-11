import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractImports } from '../../../scripts/check-boundaries.mjs';
import { Mulberry32 } from '@shared/rng';
import { decode, encode, PatternParseError, RLE_WRAP, type RleCell, type RlePattern } from '@shared/rle';

const UNDER_COVERAGE = process.env['VITEST_COVERAGE'] === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../..');
const CORPUS = join(HERE, '../../fixtures/rle/corpus');
const MALFORMED = join(HERE, '../../fixtures/rle/malformed');
const MANIFEST = JSON.parse(readFileSync(join(HERE, '../../fixtures/rle/manifest.json'), 'utf8')) as Record<
  string,
  { width: number; height: number; population: number }
>;

function cellKey(c: RleCell): string {
  return `${c.x},${c.y},${c.state}`;
}

function sortedKeys(cells: readonly RleCell[]): string[] {
  return cells.map(cellKey).sort();
}

describe('shared/rle — syntactic codec (P2-A-1)', () => {
  it('does not import engine or ruleset types', () => {
    const src = readFileSync(join(ROOT, 'src/shared/rle.ts'), 'utf8');
    for (const spec of extractImports(src)) {
      expect(spec).not.toMatch(/engine|rules/);
    }
  });

  it('select.ts and brush.ts import shared modules instead of shipping local copies', () => {
    const selectSrc = readFileSync(join(ROOT, 'src/ui/tools/select.ts'), 'utf8');
    const brushSrc = readFileSync(join(ROOT, 'src/ui/tools/brush.ts'), 'utf8');
    expect(selectSrc).toMatch(/from '@shared\/rle'/);
    expect(selectSrc).not.toMatch(/function tagForState|function stateForLetter|class Parser/);
    expect(brushSrc).toMatch(/from '@shared\/rng'/);
    expect(brushSrc).not.toMatch(/class Mulberry32|class Rng\b/);
  });

  it('round-trips a glider including #N/#O and an unknown rule string', () => {
    const text = `#N Glider
#O Richard K. Guy, 1970
#C SPDX-License-Identifier: CC0-1.0
#C source: https://conwaylife.com/wiki/Glider
x = 3, y = 3, rule = B3/S23
bo$2bo$3o!`;
    const p = decode(text);
    expect(p.width).toBe(3);
    expect(p.height).toBe(3);
    expect(p.name).toBe('Glider');
    expect(p.author).toBe('Richard K. Guy, 1970');
    expect(p.rule).toBe('B3/S23');
    expect(p.comments.some((c) => c.startsWith('SPDX-License-Identifier'))).toBe(true);
    expect(p.cells).toHaveLength(5);
    const again = decode(encode(p));
    expect(again.width).toBe(3);
    expect(again.height).toBe(3);
    expect(sortedKeys(again.cells)).toEqual(sortedKeys(p.cells));
  });

  it('decodes Golly multi-state tags including pA (state 25)', () => {
    const p = decode('x = 3, y = 1, rule = GenerationsDemo\nAopA!');
    expect(p.rule).toBe('GenerationsDemo');
    const byX = new Map(p.cells.map((c) => [c.x, c.state]));
    expect(byX.get(0)).toBe(1); // A
    expect(byX.get(1)).toBe(1); // o
    expect(byX.get(2)).toBe(25); // pA
  });

  it('treats `.` as dead and round-trips state 255 as yO', () => {
    const dotted = decode('x = 2, y = 1\n.o!');
    expect(dotted.cells).toEqual([{ x: 1, y: 0, state: 1 }]);
    const max: RlePattern = {
      width: 1,
      height: 1,
      cells: [{ x: 0, y: 0, state: 255 }],
      comments: [],
    };
    const again = decode(encode(max));
    expect(again.cells).toEqual(max.cells);
    expect(encode(max)).toMatch(/yO!/);
  });

  it('reads #P/#R offsets, #r rule, quoted header rules, and ignores unknown # lines', () => {
    const offset = decode('#R -4 7\n#r B3/S23\n#D ignored\nx = 1, y = 1\no!');
    expect(offset.offsetX).toBe(-4);
    expect(offset.offsetY).toBe(7);
    expect(offset.rule).toBe('B3/S23');
    const quoted = decode('x = 1, y = 1, rule = "B36/S23"\no!');
    expect(quoted.rule).toBe('B36/S23');
  });

  it('skips dead cells on encode and rejects out-of-range state or coordinates', () => {
    const skipped = encode(
      {
        width: 2,
        height: 1,
        cells: [
          { x: 0, y: 0, state: 0 },
          { x: 1, y: 0, state: 1 },
        ],
      },
      { trim: false },
    );
    expect(decode(skipped).cells).toEqual([{ x: 1, y: 0, state: 1 }]);
    expect(() => encode({ width: 1, height: 1, cells: [{ x: 0, y: 0, state: 256 }] })).toThrow(/0-255/);
    expect(() => encode({ width: 1, height: 1, cells: [{ x: 0, y: 0, state: -1 }] })).toThrow(/0-255/);
    expect(() => encode({ width: 1, height: 1, cells: [{ x: 2, y: 0, state: 1 }] })).toThrow(/outside/);
  });

  it('round-trips decode(encode(p)) === p for 500 random multi-state patterns', () => {
    const rng = new Mulberry32(0x2a1);
    for (let n = 0; n < 500; n++) {
      const width = 1 + rng.nextInt(12);
      const height = 1 + rng.nextInt(12);
      const count = 1 + rng.nextInt(Math.min(20, width * height));
      const seen = new Set<string>();
      const cells: RleCell[] = [];
      while (cells.length < count) {
        const x = rng.nextInt(width);
        const y = rng.nextInt(height);
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const state = 1 + rng.nextInt(40); // includes Golly pA+ tags
        cells.push({ x, y, state });
      }
      const original: RlePattern = { width, height, cells, comments: [] };
      const round = decode(encode(original, { trim: false }));
      expect(round.width).toBe(width);
      expect(round.height).toBe(height);
      expect(sortedKeys(round.cells)).toEqual(sortedKeys(cells));
    }
  });

  it('decodes a corpus of ≥ 40 real-world RLE files to their declared size and population', () => {
    const files = readdirSync(CORPUS).filter((f) => f.endsWith('.rle'));
    expect(files.length).toBeGreaterThanOrEqual(40);
    expect(Object.keys(MANIFEST).length).toBeGreaterThanOrEqual(40);
    for (const file of files) {
      const expected = MANIFEST[file];
      expect(expected, file).toBeDefined();
      const text = readFileSync(join(CORPUS, file), 'utf8');
      const p = decode(text);
      expect(p.width, file).toBe(expected!.width);
      expect(p.height, file).toBe(expected!.height);
      expect(p.cells.length, file).toBe(expected!.population);
      for (const c of p.cells) {
        expect(c.x).toBeGreaterThanOrEqual(0);
        expect(c.y).toBeGreaterThanOrEqual(0);
        expect(c.x).toBeLessThan(p.width);
        expect(c.y).toBeLessThan(p.height);
        expect(c.state).toBeGreaterThan(0);
      }
    }
  });

  it('decodes a 100k-cell RLE in under 30 ms', () => {
    const width = 400;
    const height = 250;
    const cells: RleCell[] = [];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) cells.push({ x, y, state: 1 });
    }
    const text = encode({ width, height, cells, comments: [] });
    const start = performance.now();
    const p = decode(text);
    const elapsed = performance.now() - start;
    expect(p.cells).toHaveLength(100_000);
    if (!UNDER_COVERAGE) expect(elapsed).toBeLessThan(30);
  });

  it('accepts CRLF, leading blanks, counted row skips, and a body that omits `!`', () => {
    const p = decode('#N x\r\n\r\n  x = 3, y = 3, rule = B3/S23\r\no2$o');
    expect(p.name).toBe('x');
    expect(p.cells).toEqual([
      { x: 0, y: 0, state: 1 },
      { x: 0, y: 2, state: 1 },
    ]);
  });

  it('encodes a dead gap as `b`, `#N`/`#O`/`#P`, and `#c` comments', () => {
    const text = encode({
      width: 3,
      height: 1,
      cells: [
        { x: 0, y: 0, state: 1 },
        { x: 2, y: 0, state: 2 },
      ],
      name: 'Gap',
      author: 'test',
      offsetX: 1,
      offsetY: 2,
      comments: ['hello'],
    });
    expect(text).toMatch(/^#N Gap/m);
    expect(text).toMatch(/^#O test/m);
    expect(text).toMatch(/^#P 1 2/m);
    expect(text).toMatch(/^#C hello/m);
    expect(text).toMatch(/A\.B!/);
    const lower = decode('#c note\nx = 1, y = 1\no!');
    expect(lower.comments).toEqual(['note']);
  });

  it('rejects a zero run count and an extended tag above 255', () => {
    expect(() => decode('x = 1, y = 1\n0o!')).toThrow(PatternParseError);
    expect(() => decode('x = 1, y = 1\nyP!')).toThrow(/exceeds 255/);
  });

  it('every malformed fixture produces a line, column, and hint', () => {
    const files = readdirSync(MALFORMED).filter((f) => f.endsWith('.rle'));
    expect(files.length).toBeGreaterThanOrEqual(5);
    for (const file of files) {
      const text = readFileSync(join(MALFORMED, file), 'utf8');
      try {
        decode(text);
        throw new Error(`${file} was expected to throw`);
      } catch (err) {
        expect(err, file).toBeInstanceOf(PatternParseError);
        const e = err as PatternParseError;
        expect(e.line, file).toBeGreaterThan(0);
        expect(e.column, file).toBeGreaterThan(0);
        expect(e.hint.length, file).toBeGreaterThan(0);
      }
    }
  });
});

const GLIDER_CELLS: readonly RleCell[] = [
  { x: 1, y: 0, state: 1 },
  { x: 2, y: 1, state: 1 },
  { x: 0, y: 2, state: 1 },
  { x: 1, y: 2, state: 1 },
  { x: 2, y: 2, state: 1 },
];

function gridKey(cells: readonly RleCell[]): string[] {
  return sortedKeys(cells);
}

function trimLive(p: { readonly width: number; readonly height: number; readonly cells: readonly RleCell[] }): {
  width: number;
  height: number;
  cells: RleCell[];
} {
  if (p.cells.length === 0) return { width: p.width, height: p.height, cells: [] };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of p.cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cells: p.cells.map((c) => ({ x: c.x - minX, y: c.y - minY, state: c.state })),
  };
}

describe('shared/rle — canonical encoder (P2-A-2)', () => {
  it('emits the canonical published glider byte-for-byte', () => {
    const canonical = readFileSync(join(HERE, '../../fixtures/rle/canonical/glider.rle'), 'utf8').replace(/\n$/, '');
    const padded: RlePattern = {
      width: 8,
      height: 8,
      cells: GLIDER_CELLS.map((c) => ({ x: c.x + 2, y: c.y + 3, state: c.state })),
      name: 'Glider',
      author: 'Richard K. Guy',
      rule: 'B3/S23',
      comments: [],
    };
    expect(encode(padded)).toBe(canonical);
    expect(encode(padded)).toBe(`#N Glider
#O Richard K. Guy
x = 3, y = 3, rule = B3/S23
bo$2bo$3o!`);
  });

  it('re-imports encoded multi-state patterns to identical grids', () => {
    const rng = new Mulberry32(0xa2);
    for (let n = 0; n < 200; n++) {
      const width = 4 + rng.nextInt(12);
      const height = 4 + rng.nextInt(12);
      const count = 1 + rng.nextInt(Math.min(24, width * height));
      const seen = new Set<string>();
      const cells: RleCell[] = [];
      while (cells.length < count) {
        const x = rng.nextInt(width);
        const y = rng.nextInt(height);
        const key = `${x},${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cells.push({ x, y, state: 1 + rng.nextInt(40) });
      }
      const original: RlePattern = { width, height, cells, comments: [], rule: 'GenerationsDemo' };
      const text = encode(original);
      const round = decode(text);
      const a = trimLive(original);
      const b = trimLive(round);
      expect(b.width).toBe(a.width);
      expect(b.height).toBe(a.height);
      expect(gridKey(b.cells)).toEqual(gridKey(a.cells));
    }
  });

  it('never writes a line longer than 70 characters', () => {
    const cells: RleCell[] = [];
    for (let x = 0; x < 80; x++) cells.push({ x, y: 0, state: x % 2 === 0 ? 1 : 2 });
    const text = encode({
      width: 80,
      height: 1,
      cells,
      comments: [
        'SPDX-License-Identifier: CC0-1.0 and then a deliberately long provenance note that must wrap across a 70-column budget without splitting a token in the body',
      ],
      rule: 'B3/S23',
    });
    for (const line of text.split('\n')) {
      expect(line.length, line).toBeLessThanOrEqual(RLE_WRAP);
    }
    const round = decode(text);
    expect(round.cells).toHaveLength(80);
    expect(round.comments.join(' ')).toMatch(/SPDX-License-Identifier/);
  });

  it('collapses empty rows to counted `$` and keeps two-state tags as b/o', () => {
    const text = encode({
      width: 3,
      height: 5,
      cells: [
        { x: 0, y: 0, state: 1 },
        { x: 0, y: 3, state: 1 },
      ],
    });
    expect(text).toBe('x = 1, y = 4\no3$o!');
  });
});
