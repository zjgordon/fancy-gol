/**
 * Life 1.06 codec (P2-A-3). A `#Life 1.06` header followed by one `x y` integer pair per
 * live cell. Coordinates are absolute and may be negative — the round-trip keeps them,
 * rather than silently translating to the origin.
 *
 * `#` lines after the header are comments. Two-state only (every listed cell is state `1`).
 */
import { PatternParseError, type RleCell, type RlePattern } from '../../shared/rle.js';

export interface Life106Cell {
  readonly x: number;
  readonly y: number;
}

export interface Life106Pattern {
  readonly cells: readonly Life106Cell[];
  readonly comments: readonly string[];
}

const HEADER_RE = /^#Life\s+1\.06\b/i;
const COORD_RE = /^([+-]?\d+)\s+([+-]?\d+)\s*$/;

export function decode(text: string): Life106Pattern {
  const rawLines = text.split(/\r?\n/);
  const comments: string[] = [];
  const cells: Life106Cell[] = [];
  let sawHeader = false;

  for (let i = 0; i < rawLines.length; i++) {
    const line = rawLines[i]!;
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (!sawHeader) {
      if (HEADER_RE.test(trimmed)) {
        sawHeader = true;
        continue;
      }
      if (!COORD_RE.test(trimmed)) {
        throw new PatternParseError(
          `invalid Life 1.06 header: "${trimmed}"`,
          i + 1,
          1,
          'expected a first line of `#Life 1.06` (or a bare `x y` coordinate list)',
        );
      }
      sawHeader = true;
    } else if (HEADER_RE.test(trimmed)) {
      continue;
    }
    if (trimmed.startsWith('#')) {
      comments.push(trimmed.slice(1).trim());
      continue;
    }
    const m = COORD_RE.exec(trimmed);
    if (!m) {
      const col = line.length - line.trimStart().length + 1;
      throw new PatternParseError(
        `invalid Life 1.06 coordinate line: "${trimmed}"`,
        i + 1,
        col,
        'each data line is two integers `x y` (negatives allowed), e.g. `-3 4`',
      );
    }
    cells.push({ x: Number(m[1]), y: Number(m[2]) });
  }

  if (!sawHeader) {
    throw new PatternParseError(
      'missing Life 1.06 header',
      1,
      1,
      'a Life 1.06 file starts with `#Life 1.06` then one `x y` pair per live cell',
    );
  }

  return { cells, comments };
}

export function encode(pattern: Life106Pattern): string {
  const lines = ['#Life 1.06'];
  for (const c of pattern.comments) lines.push(`# ${c}`);
  const sorted = [...pattern.cells].sort((a, b) => a.y - b.y || a.x - b.x);
  for (const c of sorted) lines.push(`${c.x} ${c.y}`);
  return lines.join('\n');
}

/** Translate absolute Life 1.06 coordinates into an {@link RlePattern} (origin at the bbox). */
export function toRlePattern(pattern: Life106Pattern): RlePattern {
  if (pattern.cells.length === 0) {
    return { width: 0, height: 0, cells: [], comments: pattern.comments };
  }
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const c of pattern.cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
    if (c.x > maxX) maxX = c.x;
    if (c.y > maxY) maxY = c.y;
  }
  const cells: RleCell[] = pattern.cells.map((c) => ({
    x: c.x - minX,
    y: c.y - minY,
    state: 1,
  }));
  return {
    width: maxX - minX + 1,
    height: maxY - minY + 1,
    cells,
    comments: pattern.comments,
    offsetX: minX,
    offsetY: minY,
  };
}

export function fromRlePattern(pattern: RlePattern): Life106Pattern {
  const ox = pattern.offsetX ?? 0;
  const oy = pattern.offsetY ?? 0;
  return {
    comments: pattern.comments,
    cells: pattern.cells.filter((c) => c.state !== 0).map((c) => ({ x: c.x + ox, y: c.y + oy })),
  };
}

export const decodeLife106 = decode;
export const encodeLife106 = encode;
