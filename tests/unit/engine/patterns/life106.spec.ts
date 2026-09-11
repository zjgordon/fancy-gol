import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decode, encode, fromRlePattern, toRlePattern } from '@engine/patterns/life106';
import { PatternParseError } from '@shared/rle';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '../../../fixtures/patterns/life106');

function coordKey(c: { x: number; y: number }): string {
  return `${c.x},${c.y}`;
}

describe('Life 1.06 (P2-A-3)', () => {
  it('decodes a headered coordinate list', () => {
    const p = decode(readFileSync(join(FIXTURES, 'glider.life'), 'utf8'));
    expect(p.cells).toHaveLength(5);
    expect(p.cells.map(coordKey).sort()).toEqual(['0,2', '1,0', '1,2', '2,1', '2,2']);
    expect(p.comments.some((c) => /Glider/i.test(c))).toBe(true);
  });

  it('round-trips including negative coordinates', () => {
    const original = decode(readFileSync(join(FIXTURES, 'negative.life'), 'utf8'));
    expect(original.cells.some((c) => c.x < 0 || c.y < 0)).toBe(true);
    const again = decode(encode(original));
    expect(again.cells.map(coordKey).sort()).toEqual(original.cells.map(coordKey).sort());
  });

  it('round-trips an in-memory list that includes negatives and duplicates-removed order', () => {
    const cells = [
      { x: -10, y: 4 },
      { x: 0, y: 0 },
      { x: 3, y: -7 },
    ];
    const again = decode(encode({ cells, comments: ['n'] }));
    expect(again.cells.map(coordKey).sort()).toEqual(cells.map(coordKey).sort());
    expect(again.comments).toContain('n');
  });

  it('maps negatives onto an RlePattern bbox via offsetX/offsetY', () => {
    const p = decode(readFileSync(join(FIXTURES, 'negative.life'), 'utf8'));
    const rle = toRlePattern(p);
    expect(rle.offsetX).toBeLessThan(0);
    expect(rle.cells.every((c) => c.x >= 0 && c.y >= 0)).toBe(true);
    const back = fromRlePattern(rle);
    expect(back.cells.map(coordKey).sort()).toEqual(p.cells.map(coordKey).sort());
  });

  it('accepts a headerless coordinate list', () => {
    const p = decode('0 0\n-1 2\n');
    expect(p.cells).toEqual([
      { x: 0, y: 0 },
      { x: -1, y: 2 },
    ]);
  });

  it('rejects an empty file as missing a header', () => {
    expect(() => decode('')).toThrow(/missing Life 1.06 header/);
  });

  it('decodes a header-only file as an empty pattern', () => {
    expect(decode('#Life 1.06\n').cells).toEqual([]);
  });

  it('rejects a garbage line with line, column, and hint', () => {
    try {
      decode('#Life 1.06\n1 banana\n');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PatternParseError);
      const e = err as PatternParseError;
      expect(e.line).toBe(2);
      expect(e.column).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(0);
    }
  });
});
