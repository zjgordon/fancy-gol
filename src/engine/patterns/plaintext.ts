/**
 * Life plaintext / `.cells` codec (P2-A-3). Comment lines start with `!`; `!Name:` and
 * `!Author:` are the conventional headers. Live cells are `O`, `o`, or `*`; dead is `.`.
 * Each data row is trailing-whitespace-trimmed before width is measured — a row of
 * `.O.   ` is three cells, not six.
 *
 * Two-state only. Interpretation of "alive" is state `1`; the caller maps that onto a
 * ruleset. No DOM, no I/O.
 */
import { PatternParseError, type RleCell, type RlePattern } from '../../shared/rle.js';

const NAME_RE = /^!Name:\s*(.*)$/i;
const AUTHOR_RE = /^!Author:\s*(.*)$/i;

export function decode(text: string): RlePattern {
  const rawLines = text.split(/\r?\n/);
  let name: string | undefined;
  let author: string | undefined;
  const comments: string[] = [];
  const rows: string[] = [];
  let inData = false;

  for (let i = 0; i < rawLines.length; i++) {
    const trimmed = rawLines[i]!.trimEnd();
    if (!inData) {
      if (trimmed.startsWith('!')) {
        const nameMatch = NAME_RE.exec(trimmed);
        if (nameMatch) {
          name = nameMatch[1]!.trim();
          continue;
        }
        const authorMatch = AUTHOR_RE.exec(trimmed);
        if (authorMatch) {
          author = authorMatch[1]!.trim();
          continue;
        }
        const rest = trimmed.slice(1).trim();
        if (rest.length > 0) comments.push(rest);
        continue;
      }
      if (trimmed.length === 0) continue;
      inData = true;
    }
    rows.push(trimmed);
  }

  while (rows.length > 0 && rows[rows.length - 1] === '') rows.pop();

  const width = rows.reduce((w, row) => Math.max(w, row.length), 0);
  const height = rows.length;
  const cells: RleCell[] = [];

  for (let y = 0; y < rows.length; y++) {
    const row = rows[y]!;
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]!;
      if (ch === '.' || ch === ' ') continue;
      if (ch === 'O' || ch === 'o' || ch === '*') {
        cells.push({ x, y, state: 1 });
        continue;
      }
      throw new PatternParseError(
        `unexpected character ${JSON.stringify(ch)} in plaintext row`,
        y + 1,
        x + 1,
        'plaintext cells are `.` (dead) or `O`/`o`/`*` (live); comment lines start with `!`',
      );
    }
  }

  return {
    width,
    height,
    cells,
    comments,
    ...(name !== undefined && name.length > 0 ? { name } : {}),
    ...(author !== undefined && author.length > 0 ? { author } : {}),
  };
}

export function encode(pattern: Omit<RlePattern, 'comments'> & { readonly comments?: readonly string[] }): string {
  const lines: string[] = [];
  if (pattern.name !== undefined) lines.push(`!Name: ${pattern.name}`);
  if (pattern.author !== undefined) lines.push(`!Author: ${pattern.author}`);
  for (const c of pattern.comments ?? []) lines.push(`!${c}`);

  const live = new Set<string>();
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const cell of pattern.cells) {
    if (cell.state === 0) continue;
    live.add(`${cell.x},${cell.y}`);
    if (cell.x < minX) minX = cell.x;
    if (cell.y < minY) minY = cell.y;
    if (cell.x > maxX) maxX = cell.x;
    if (cell.y > maxY) maxY = cell.y;
  }

  if (live.size === 0) {
    return lines.length > 0 ? `${lines.join('\n')}\n` : '';
  }

  for (let y = minY; y <= maxY; y++) {
    let last = minX - 1;
    for (let x = maxX; x >= minX; x--) {
      if (live.has(`${x},${y}`)) {
        last = x;
        break;
      }
    }
    let row = '';
    for (let x = minX; x <= last; x++) row += live.has(`${x},${y}`) ? 'O' : '.';
    lines.push(row);
  }
  return lines.join('\n');
}

export const decodePlaintext = decode;
export const encodePlaintext = encode;
