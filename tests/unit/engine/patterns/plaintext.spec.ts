import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { decode, encode } from '@engine/patterns/plaintext';
import { PatternParseError } from '@shared/rle';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURES = join(HERE, '../../../fixtures/patterns/plaintext');

const GLIDER = [
  { x: 1, y: 0, state: 1 },
  { x: 2, y: 1, state: 1 },
  { x: 0, y: 2, state: 1 },
  { x: 1, y: 2, state: 1 },
  { x: 2, y: 2, state: 1 },
];

describe('plaintext / .cells (P2-A-3)', () => {
  it('decodes !Name: / !Author: headers and a glider', () => {
    const text = readFileSync(join(FIXTURES, 'glider.cells'), 'utf8');
    const p = decode(text);
    expect(p.name).toBe('Glider');
    expect(p.author).toBe('Richard K. Guy');
    expect(p.width).toBe(3);
    expect(p.height).toBe(3);
    expect(p.cells).toEqual(GLIDER);
    expect(p.comments.some((c) => /spaceship/i.test(c))).toBe(true);
  });

  it('trims trailing whitespace on data rows before measuring width', () => {
    const text = readFileSync(join(FIXTURES, 'padded-glider.cells'), 'utf8');
    const p = decode(text);
    expect(p.name).toBe('Padded glider');
    expect(p.width).toBe(3);
    expect(p.height).toBe(3);
    expect(p.cells).toEqual(GLIDER);
  });

  it('accepts * as live and skips blank lines before the grid', () => {
    const p = decode('!Name: Block\n\n**\n**\n');
    expect(p.name).toBe('Block');
    expect(p.width).toBe(2);
    expect(p.height).toBe(2);
    expect(p.cells).toHaveLength(4);
  });

  it('rejects a stray character with line, column, and hint', () => {
    try {
      decode('!Name: Bad\n.X.\n');
      throw new Error('expected throw');
    } catch (err) {
      expect(err).toBeInstanceOf(PatternParseError);
      const e = err as PatternParseError;
      expect(e.line).toBeGreaterThan(0);
      expect(e.column).toBeGreaterThan(0);
      expect(e.hint.length).toBeGreaterThan(0);
    }
  });

  it('round-trips a named pattern through encode', () => {
    const original = decode(readFileSync(join(FIXTURES, 'block.cells'), 'utf8'));
    const again = decode(encode(original));
    expect(again.name).toBe(original.name);
    expect(again.cells).toEqual(original.cells);
    expect(again.width).toBe(original.width);
    expect(again.height).toBe(original.height);
  });

  it('encodes !Name:/!Author: and omits trailing dead cells', () => {
    const text = encode({
      width: 4,
      height: 2,
      cells: [
        { x: 0, y: 0, state: 1 },
        { x: 1, y: 1, state: 1 },
      ],
      name: 'L',
      author: 'test',
      comments: ['note'],
    });
    expect(text).toBe('!Name: L\n!Author: test\n!note\nO\n.O');
  });

  it('ships at least two .cells fixtures', () => {
    const files = readdirSync(FIXTURES).filter((f) => f.endsWith('.cells'));
    expect(files.length).toBeGreaterThanOrEqual(2);
  });
});
