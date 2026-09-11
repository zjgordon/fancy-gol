/**
 * Shared helpers for the P2-B-5 catalogue writer. ASCII grids become cells;
 * the shared encoder emits the body; the real Simulation gates still lifes,
 * oscillators and spaceships before anything hits disk.
 */
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decode, encode } from '../src/shared/rle.ts';
import { getBuiltin } from '../src/engine/rules/builtin/index.ts';
import { Simulation } from '../src/engine/simulation.ts';

export const RULE_NOTATION = {
  conway: 'B3/S23',
  highlife: 'B36/S23',
  'day-and-night': 'B3678/S34678',
  seeds: 'B2/S',
  replicator: 'B1357/S1357',
  diamoeba: 'B35678/S5678',
  maze: 'B3/S12345',
  'two-by-two': 'B36/S125',
  'life-without-death': 'B3/S012345678',
  'brians-brain': "Brian's Brain",
  wireworld: 'WireWorld',
  'star-wars': 'B345/S2/G4',
  bloomerang: 'B34678/S234/G24',
  'highlands-liquid': 'Highlands/Liquid',
};

const STATE_CHARS = {
  o: 1,
  O: 1,
  A: 1,
  B: 2,
  C: 3,
  D: 4,
  E: 5,
  F: 6,
  G: 7,
  H: 8,
};

/** Decode a Golly body or a full `x = …` header into live cells. */
export function cellsFromRle(rle) {
  const text = /x\s*=/.test(rle) ? rle : `x = 256, y = 256, rule = B3/S23\n${rle}`;
  return decode(text).cells.filter((c) => c.state !== 0);
}

export function cellsFromGrid(grid) {
  const rows = grid
    .replace(/^\n/, '')
    .replace(/\n$/, '')
    .split('\n')
    .map((r) => r.replace(/ /g, ''));
  const cells = [];
  for (let y = 0; y < rows.length; y++) {
    const row = rows[y];
    for (let x = 0; x < row.length; x++) {
      const ch = row[x];
      if (ch === '.' || ch === 'b' || ch === 'x') continue;
      const state = STATE_CHARS[ch];
      if (state === undefined) throw new Error(`bad grid char "${ch}"`);
      cells.push({ x, y, state });
    }
  }
  return cells;
}

export function wrapC(text, width = 70, field) {
  const prefix = field ? `#C ${field}: ` : '#C ';
  const budget = width - prefix.length;
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (next.length > budget && cur) {
      lines.push(prefix + cur);
      cur = w;
    } else cur = next;
  }
  if (cur) lines.push(prefix + cur);
  return lines;
}

function originShift(cells) {
  let minX = Infinity;
  let minY = Infinity;
  for (const c of cells) {
    if (c.x < minX) minX = c.x;
    if (c.y < minY) minY = c.y;
  }
  if (!Number.isFinite(minX)) return cells;
  return cells.map((c) => ({ ...c, x: c.x - minX, y: c.y - minY }));
}

export function renderFile(spec) {
  const cells = originShift(spec.cells ?? cellsFromGrid(spec.grid));
  if (cells.length === 0) throw new Error(`${spec.id}: empty grid`);
  const maxX = Math.max(...cells.map((c) => c.x));
  const maxY = Math.max(...cells.map((c) => c.y));
  const body = encode(
    {
      width: Math.max(512, maxX + 1),
      height: Math.max(512, maxY + 1),
      cells,
      rule: RULE_NOTATION[spec.ruleset],
    },
    { trim: true },
  );
  const yearBit = spec.year ? `, ${spec.year}` : '';
  const author = spec.author ?? 'unknown';
  const lines = [
    `#N ${spec.name}`,
    `#O ${author}${yearBit}`,
    '#C SPDX-License-Identifier: CC0-1.0',
    spec.origin === 'A'
      ? '#C SPDX-FileCopyrightText: originated in fancy-gol P2-B-5 (CC0)'
      : '#C SPDX-FileCopyrightText: none claimed (configuration; see SOURCES.md §2)',
    `#C source: ${spec.source}`,
    `#C verified: fancy-gol P2-B-5, ${spec.verified}`,
    `#C ruleset: ${spec.ruleset}`,
    `#C category: ${spec.category}`,
    `#C period: ${spec.period ?? 'none'}`,
  ];
  if (spec.speed) lines.push(`#C speed: ${spec.speed}`);
  if (spec.aliases?.length) lines.push(`#C aliases: ${spec.aliases.join(', ')}`);
  if (spec.tags?.length) lines.push(`#C tags: ${spec.tags.join(', ')}`);
  for (const para of spec.description) lines.push(...wrapC(para, 70, 'description'));
  lines.push(body);
  if (!lines[lines.length - 1].endsWith('\n') && !body.endsWith('\n')) {
    /* encode has no trailing newline guarantee */
  }
  return `${lines.join('\n')}\n`;
}

function liveList(sim, x0, y0, x1, y1) {
  const out = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = sim.get(x, y);
      if (s !== 0) out.push([x, y, s]);
    }
  }
  return out;
}

function keyOf(cells) {
  return cells
    .map(([x, y, s]) => `${x},${y},${s}`)
    .sort()
    .join(';');
}

function findDisp(a, b) {
  if (a.length === 0 || a.length !== b.length) return null;
  const target = new Set(b.map(([x, y, s]) => `${x},${y},${s}`));
  const first = a[0];
  if (!first) return null;
  const [x0, y0] = first;
  for (const [x1, y1] of b) {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (a.every(([x, y, s]) => target.has(`${x + dx},${y + dy},${s}`))) return [dx, dy];
  }
  return null;
}

export function verifySpec(spec) {
  const cells = spec.cells ?? cellsFromGrid(spec.grid);
  const rs = getBuiltin(spec.ruleset);
  if (!rs) return `${spec.id}: unknown ruleset ${spec.ruleset}`;
  const OX = 48;
  const OY = 48;
  const sim = new Simulation({ ruleset: { ...rs, boundary: 'infinite' } });
  for (const c of cells) sim.set(OX + c.x, OY + c.y, c.state);
  const growing = spec.category === 'gun' || spec.category === 'puffer' || spec.category === 'rake';
  const pad = growing ? 160 : 48;
  const maxX = OX + Math.max(...cells.map((c) => c.x)) + pad;
  const maxY = OY + Math.max(...cells.map((c) => c.y)) + pad;
  const box = () => liveList(sim, OX - pad, OY - pad, maxX, maxY);
  const start = box();
  const startKey = keyOf(start);

  if (spec.category === 'still-life' || (spec.category === 'reflector' && spec.period === 1)) {
    if (spec.period !== 1) return `${spec.id}: still-life period ${spec.period}`;
    sim.step();
    if (keyOf(box()) !== startKey) return `${spec.id}: still-life moved`;
    return null;
  }
  if (spec.category === 'oscillator') {
    const limit = spec.period;
    if (!limit || limit < 2) return `${spec.id}: bad oscillator period`;
    let first = 0;
    for (let i = 1; i <= limit; i++) {
      sim.step();
      if (keyOf(box()) === startKey) {
        first = i;
        break;
      }
    }
    if (first !== limit) return `${spec.id}: first-repeat ${first || 'none'} declared ${limit}`;
    return null;
  }
  if (spec.category === 'spaceship') {
    if (!spec.period || !spec.speed) return `${spec.id}: spaceship needs period/speed`;
    for (let i = 0; i < spec.period; i++) sim.step();
    const after = box();
    const disp = findDisp(start, after);
    if (!disp) return `${spec.id}: did not translate (start ${start.length} after ${after.length})`;
    return null;
  }
  if (spec.category === 'gun' || spec.category === 'puffer' || spec.category === 'rake') {
    const n = spec.period ?? 60;
    for (let i = 0; i < n; i++) sim.step();
    if (box().length <= start.length) return `${spec.id}: ${spec.category} did not grow after ${n}`;
    return null;
  }
  return null;
}

export function writeSpec(dir, spec) {
  const err = verifySpec(spec);
  if (err) throw new Error(err);
  const text = renderFile(spec);
  writeFileSync(join(dir, `${spec.id}.rle`), text);
}
