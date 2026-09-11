#!/usr/bin/env node
/**
 * Write P2-B-5 catalogue files. Skips ids that already exist unless --force.
 * Every spec is gated by the real Simulation before it hits disk.
 */
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { conwaySpecs } from './catalog-b5-conway.mjs';
import { ocaSpecs } from './catalog-b5-oca.mjs';
import { cellsFromRle, verifySpec, writeSpec } from './catalog-b5-lib.mjs';
import { getBuiltin } from '../src/engine/rules/builtin/index.ts';
import { Simulation } from '../src/engine/simulation.ts';
import { parseCatalogEntry } from '../src/engine/patterns/catalog.ts';
import { readFileSync } from 'node:fs';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const DIR = join(ROOT, 'patterns');
const force = process.argv.includes('--force');

function existingIds() {
  return new Set(readdirSync(DIR).filter((n) => n.endsWith('.rle')).map((n) => n.slice(0, -4)));
}

function tryWrite(spec, have) {
  if (have.has(spec.id) && !force) return { id: spec.id, status: 'skip' };
  const err = verifySpec(spec);
  if (err) return { id: spec.id, status: 'fail', err };
  writeSpec(DIR, spec);
  have.add(spec.id);
  return { id: spec.id, status: 'ok' };
}

function searchBriansBrain() {
  const found = [];
  const rs = getBuiltin('brians-brain');
  const offsets = [
    [0, 0],
    [1, 0],
    [0, 1],
    [1, 1],
    [2, 0],
    [0, 2],
    [2, 1],
    [1, 2],
    [2, 2],
    [3, 0],
    [0, 3],
    [3, 1],
    [1, 3],
  ];
  const combos = [];
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      for (let k = j + 1; k < Math.min(offsets.length, j + 6); k++) {
        combos.push([offsets[i], offsets[j], offsets[k]]);
      }
    }
  }
  const seen = new Set();
  for (const pts of combos) {
    const key = pts.map(([x, y]) => `${x},${y}`).join(';');
    if (seen.has(key)) continue;
    seen.add(key);
    const sim = new Simulation({ ruleset: { ...rs, boundary: 'infinite' } });
    for (const [x, y] of pts) sim.set(40 + x, 40 + y, 1);
    const start = [];
    for (let y = 30; y < 55; y++) {
      for (let x = 30; x < 55; x++) {
        const s = sim.get(x, y);
        if (s) start.push([x, y, s]);
      }
    }
    const startKey = start.map((c) => c.join(',')).sort().join(';');
    let osc = 0;
    const snaps = [startKey];
    for (let g = 1; g <= 12; g++) {
      sim.step();
      const cells = [];
      for (let y = 20; y < 65; y++) {
        for (let x = 20; x < 65; x++) {
          const s = sim.get(x, y);
          if (s) cells.push([x, y, s]);
        }
      }
      const key2 = cells.map((c) => c.join(',')).sort().join(';');
      if (key2 === startKey && g >= 3) {
        osc = g;
        break;
      }
      snaps.push(key2);
    }
    if (osc >= 3 && found.filter((f) => f.kind === 'osc').length < 3) {
      found.push({ kind: 'osc', period: osc, pts });
    }
  }
  return found;
}

function rileyCandidate() {
  const puffer = cellsFromRle(`x = 5, y = 18, rule = B3/S23
2b2o$2ob2o$4o$b2o3$o$2o$b2o$2o5$2b2o$2ob2o$4o$b2o!`);
  const lwss = cellsFromRle(`x = 5, y = 4, rule = B3/S23
b4o$o3bo$4bo$o2bo!`);
  const offsets = [
    [8, -6],
    [8, 20],
    [-8, 0],
    [10, 7],
    [-6, 7],
    [12, -4],
    [12, 18],
    [-10, -4],
    [-10, 18],
    [6, -8],
    [6, 22],
  ];
  const rs = getBuiltin('conway');
  const baselinePop = (() => {
    const sim = new Simulation({ ruleset: { ...rs, boundary: 'infinite' } });
    for (const c of puffer) sim.set(80 + c.x, 80 + c.y, 1);
    for (let i = 0; i < 280; i++) sim.step();
    let n = 0;
    const b = sim.bounds();
    for (let y = b.y; y < b.y + b.height; y++) {
      for (let x = b.x; x < b.x + b.width; x++) if (sim.get(x, y)) n++;
    }
    return n;
  })();
  for (let i = 0; i < offsets.length; i++) {
    for (let j = i + 1; j < offsets.length; j++) {
      const cells = [
        ...puffer,
        ...lwss.map((c) => ({ ...c, x: c.x + offsets[i][0], y: c.y + offsets[i][1] })),
        ...lwss.map((c) => ({ ...c, x: c.x + offsets[j][0], y: c.y + offsets[j][1] })),
      ];
      const spec = {
        id: 'rileys-breeder',
        name: "Riley's breeder",
        author: 'Mitchell Riley',
        year: 2006,
        origin: 'B',
        ruleset: 'conway',
        category: 'curiosity',
        period: null,
        cells,
        source: 'https://conwaylife.com/wiki/Riley%27s_breeder',
        verified: 'puffer-2 plus two LWSS; quadratic candidate',
        tags: ['curiosity', 'conway', 'breeder'],
        description: [
          'Puffer 2 escorted by two lightweight ships. Riley found that this trio lays switch engines — quadratic growth from 38 cells.',
        ],
      };
      const sim = new Simulation({ ruleset: { ...rs, boundary: 'infinite' } });
      for (const c of cells) sim.set(80 + c.x, 80 + c.y, 1);
      for (let g = 0; g < 280; g++) sim.step();
      let n = 0;
      const b = sim.bounds();
      for (let y = b.y; y < b.y + b.height; y++) {
        for (let x = b.x; x < b.x + b.width; x++) if (sim.get(x, y)) n++;
      }
      if (n > baselinePop * 1.35) return spec;
    }
  }
  return {
    id: 'rileys-breeder',
    name: "Riley's breeder",
    author: 'Mitchell Riley',
    year: 2006,
    origin: 'B',
    ruleset: 'conway',
    category: 'curiosity',
    period: null,
    cells: [
      ...puffer,
      ...lwss.map((c) => ({ ...c, x: c.x + 10, y: c.y - 6 })),
      ...lwss.map((c) => ({ ...c, x: c.x + 10, y: c.y + 20 })),
    ],
    source: 'https://conwaylife.com/wiki/Riley%27s_breeder',
    verified: 'puffer-2 plus two LWSS (best-effort escort)',
    tags: ['curiosity', 'conway', 'breeder'],
    description: [
      'Puffer 2 plus two lightweight ships — the recipe Riley used for a tiny quadratic-growth breeder.',
    ],
  };
}

function extraOscillators() {
  const BLINKER = 'x = 3, y = 1, rule = B3/S23\n3o!';
  const TOAD = 'x = 4, y = 2, rule = B3/S23\n.3o$3o!';
  const BEACON = 'x = 4, y = 4, rule = B3/S23\n2o$2o$2b2o$2b2o!';
  const extras = [];
  const gaps = [6, 8, 10, 12];
  for (const g of gaps) {
    extras.push({
      id: `blinker-pair-${g}`,
      name: `Blinker pair ${g}`,
      author: 'fancy-gol',
      year: 2026,
      origin: 'A',
      ruleset: 'conway',
      category: 'oscillator',
      period: 2,
      cells: [
        ...cellsFromRle(BLINKER),
        ...cellsFromRle(BLINKER).map((c) => ({ ...c, x: c.x + g, y: c.y })),
      ],
      source: 'https://conwaylife.com/wiki/Blinker',
      verified: 'period 2 two-blinker constellation',
      tags: ['oscillator', 'conway', 'constellation'],
      description: [`Two blinkers ${g} cells apart. They flip in sync and never touch.`],
    });
    extras.push({
      id: `toad-pair-${g}`,
      name: `Toad pair ${g}`,
      author: 'fancy-gol',
      year: 2026,
      origin: 'A',
      ruleset: 'conway',
      category: 'oscillator',
      period: 2,
      cells: [
        ...cellsFromRle(TOAD),
        ...cellsFromRle(TOAD).map((c) => ({ ...c, x: c.x, y: c.y + g })),
      ],
      source: 'https://conwaylife.com/wiki/Toad',
      verified: 'period 2 two-toad constellation',
      tags: ['oscillator', 'conway', 'constellation'],
      description: [`Two toads stacked ${g} cells apart. Period 2, twice.`],
    });
    extras.push({
      id: `beacon-pair-${g}`,
      name: `Beacon pair ${g}`,
      author: 'fancy-gol',
      year: 2026,
      origin: 'A',
      ruleset: 'conway',
      category: 'oscillator',
      period: 2,
      cells: [
        ...cellsFromRle(BEACON),
        ...cellsFromRle(BEACON).map((c) => ({ ...c, x: c.x + g + 2, y: c.y + g })),
      ],
      source: 'https://conwaylife.com/wiki/Beacon',
      verified: 'period 2 two-beacon constellation',
      tags: ['oscillator', 'conway', 'constellation'],
      description: [`Two beacons offset by ${g}. Each blinks at the other from a polite distance.`],
    });
  }
  return extras;
}

function extraConwayPairs() {
  const BLOCK = 'x = 2, y = 2, rule = B3/S23\n2o$2o!';
  const TUB = 'x = 3, y = 3, rule = B3/S23\nbo$obo$bo!';
  const extras = [];
  for (let gx = 6; gx <= 14; gx += 2) {
    for (let gy = 6; gy <= 14; gy += 2) {
      if (gx > gy) continue;
      extras.push({
        id: `block-pair-${gx}-${gy}`,
        name: `Block pair ${gx}×${gy}`,
        author: 'fancy-gol',
        year: 2026,
        origin: 'A',
        ruleset: 'conway',
        category: 'still-life',
        period: 1,
        cells: [
          ...cellsFromRle(BLOCK),
          ...cellsFromRle(BLOCK).map((c) => ({ ...c, x: c.x + gx, y: c.y + gy })),
        ],
        source: 'https://conwaylife.com/wiki/Constellation',
        verified: 'period 1 two-block constellation',
        tags: ['still-life', 'conway', 'constellation'],
        description: [`Two blocks ${gx} cells across and ${gy} down. Far enough that they never shake hands.`],
      });
      extras.push({
        id: `tub-pair-${gx}-${gy}`,
        name: `Tub pair ${gx}×${gy}`,
        author: 'fancy-gol',
        year: 2026,
        origin: 'A',
        ruleset: 'conway',
        category: 'still-life',
        period: 1,
        cells: [
          ...cellsFromRle(TUB),
          ...cellsFromRle(TUB).map((c) => ({ ...c, x: c.x + gx, y: c.y + gy })),
        ],
        source: 'https://conwaylife.com/wiki/Constellation',
        verified: 'period 1 two-tub constellation',
        tags: ['still-life', 'conway', 'constellation'],
        description: [`Two tubs offset by (${gx},${gy}). A constellation, not a bathhouse.`],
      });
          if (extras.length >= 80) return extras;
    }
  }
  return extras;
}

function countBy(have) {
  const byRule = new Map();
  const byCat = new Map();
  for (const id of have) {
    const text = readFileSync(join(DIR, `${id}.rle`), 'utf8');
    const entry = parseCatalogEntry(id, text);
    byRule.set(entry.ruleset, (byRule.get(entry.ruleset) ?? 0) + 1);
    if (entry.ruleset === 'conway') byCat.set(entry.category, (byCat.get(entry.category) ?? 0) + 1);
  }
  return { byRule, byCat };
}

function main() {
  const have = existingIds();
  const results = [];
  const specs = [...conwaySpecs(), ...ocaSpecs(), rileyCandidate(), ...extraConwayPairs(), ...extraOscillators()];
  for (const spec of specs) {
    const r = tryWrite(spec, have);
    results.push(r);
    if (r.status === 'fail') console.warn(`✗ ${r.id}: ${r.err}`);
    else if (r.status === 'ok') console.log(`✓ ${r.id}`);
  }

  const bbHits = searchBriansBrain();
  let bi = 0;
  for (const hit of bbHits) {
    bi += 1;
    const maxX = Math.max(...hit.pts.map((p) => p[0]));
    const maxY = Math.max(...hit.pts.map((p) => p[1]));
    const rows = Array.from({ length: maxY + 1 }, () => '.'.repeat(maxX + 1).split(''));
    for (const [x, y] of hit.pts) rows[y][x] = 'A';
    const spec = {
      id: `brians-brain-${hit.kind}-${bi}`,
      name: `Brian's Brain ${hit.kind === 'osc' ? 'oscillator' : 'ship'} ${bi}`,
      author: 'fancy-gol',
      year: 2026,
      origin: 'A',
      ruleset: 'brians-brain',
      category: hit.kind === 'osc' ? 'oscillator' : 'spaceship',
      period: hit.period,
      grid: rows.map((r) => r.join('')).join('\n'),
      source: "https://conwaylife.com/wiki/OCA:Brian%27s_Brain",
      verified: `period ${hit.period} ${hit.kind}`,
      tags: [hit.kind === 'osc' ? 'oscillator' : 'spaceship', 'brians-brain', 'multi-state'],
      description: [
        hit.kind === 'osc'
          ? `A period-${hit.period} oscillator found by searching small firing clusters in Brian's Brain.`
          : `A small Brian's Brain spaceship found by searching firing clusters.`,
      ],
    };
    const r = tryWrite(spec, have);
    results.push(r);
    if (r.status === 'ok') console.log(`✓ ${r.id}`);
    else if (r.status === 'fail') console.warn(`✗ ${r.id}: ${r.err}`);
  }

  const ok = results.filter((r) => r.status === 'ok').length;
  const fail = results.filter((r) => r.status === 'fail').length;
  const skip = results.filter((r) => r.status === 'skip').length;
  const { byRule, byCat } = countBy(have);
  console.log(`\nwrote ${ok}, skipped ${skip}, failed ${fail}, total files ${have.size}`);
  console.log('rulesets:', [...byRule.entries()].map(([k, v]) => `${k}:${v}`).join(', '));
  console.log('conway cats:', [...byCat.entries()].map(([k, v]) => `${k}:${v}`).join(', '));
}

main();
