import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { parseCatalogEntry } from '@engine/patterns/catalog';
import { findCanonicalCollisions } from '@engine/patterns/normalize';
import { getBuiltin } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { decode } from '@shared/rle';
import { collectRleFiles } from '../../../../scripts/check-pattern-licenses.mjs';

const PATTERNS = join(dirname(fileURLToPath(import.meta.url)), '../../../../patterns');
const OX = 40;
const OY = 40;
const STAMP_IDS = [
  'block',
  'blinker',
  'glider',
  'toad',
  'beacon',
  'lwss',
  'r-pentomino',
  'acorn',
  'pulsar',
  'gosper-gun',
];

function liveCells(sim: Simulation, x0: number, y0: number, x1: number, y1: number) {
  const out: Array<[number, number, number]> = [];
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const s = sim.get(x, y);
      if (s !== 0) out.push([x, y, s]);
    }
  }
  return out;
}

function keyOf(cells: Array<[number, number, number]>): string {
  return cells
    .map(([x, y, s]) => `${x},${y},${s}`)
    .sort()
    .join(';');
}

function findDisp(
  a: Array<[number, number, number]>,
  b: Array<[number, number, number]>,
): readonly [number, number] | null {
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

function loadAll() {
  const files = collectRleFiles(PATTERNS);
  return files.map((file) => {
    const id = file.slice(file.lastIndexOf('/') + 1, -'.rle'.length);
    const text = readFileSync(file, 'utf8');
    return { id, file, text, entry: parseCatalogEntry(id, text), decoded: decode(text) };
  });
}

describe('P2-B-1 seed catalogue', () => {
  const all = loadAll();

  it('ships at least 200 patterns across at least 10 rulesets', () => {
    expect(all.length).toBeGreaterThanOrEqual(200);
    const rulesets = new Set(all.map((p) => p.entry.ruleset));
    expect(rulesets.size).toBeGreaterThanOrEqual(10);
    expect(rulesets.has('conway')).toBe(true);
  });

  it('meets the P2-B-5 per-ruleset minimums and Conway covers every category', () => {
    const byRule = new Map<string, number>();
    const conwayCats = new Set<string>();
    for (const p of all) {
      byRule.set(p.entry.ruleset, (byRule.get(p.entry.ruleset) ?? 0) + 1);
      if (p.entry.ruleset === 'conway') conwayCats.add(p.entry.category);
    }
    const min: Record<string, number> = {
      conway: 120,
      highlife: 10,
      'day-and-night': 5,
      seeds: 5,
      maze: 5,
      diamoeba: 5,
      replicator: 5,
      'two-by-two': 5,
      'life-without-death': 5,
      'brians-brain': 8,
      wireworld: 10,
      'star-wars': 5,
      bloomerang: 5,
      'highlands-liquid': 4,
    };
    for (const [id, n] of Object.entries(min)) {
      expect(byRule.get(id) ?? 0, id).toBeGreaterThanOrEqual(n);
    }
    expect(all.some((p) => p.id === 'highlife-replicator')).toBe(true);
    expect(all.some((p) => p.id === 'herschel')).toBe(true);
    expect(all.some((p) => p.entry.ruleset === 'conway' && p.entry.tags.includes('breeder'))).toBe(true);
    const required = [
      'still-life',
      'oscillator',
      'spaceship',
      'puffer',
      'rake',
      'gun',
      'methuselah',
      'wick',
      'agar',
      'reflector',
      'logic',
      'seed',
      'curiosity',
    ];
    for (const cat of required) expect(conwayCats.has(cat), cat).toBe(true);
  });

  it('includes the ten Phase 1 stamp ids', () => {
    const ids = new Set(all.map((p) => p.id));
    for (const id of STAMP_IDS) expect(ids.has(id)).toBe(true);
  });

  it('includes at least one multi-state ruleset', () => {
    const multi = all.filter((p) => p.entry.ruleset === 'brians-brain' || p.entry.ruleset === 'wireworld');
    expect(multi.length).toBeGreaterThanOrEqual(1);
  });

  it('every entry decodes to its declared width, height and population', () => {
    for (const p of all) {
      const pop = p.decoded.cells.filter((c) => c.state !== 0).length;
      expect(p.decoded.width, p.id).toBe(p.entry.width);
      expect(p.decoded.height, p.id).toBe(p.entry.height);
      expect(pop, p.id).toBe(p.entry.population);
    }
  });

  it('every entry has a source URL and original description', () => {
    for (const p of all) {
      expect(p.entry.source, p.id).toMatch(/^https?:\/\//);
      expect(p.entry.description.length, p.id).toBeGreaterThan(20);
      expect(p.entry.description, p.id).not.toMatch(/LifeWiki/i);
    }
  });

  it('contains no two names that share a canonical hash', () => {
    expect(
      findCanonicalCollisions(all.map((p) => ({ name: p.entry.name, cells: p.decoded.cells }))),
    ).toEqual([]);
  });

  it('still lifes, oscillators, spaceships and guns match their declared period/speed under simulation', () => {
    const failures: string[] = [];
    const report = (id: string, msg: string) => {
      failures.push(`${id}: ${msg}`);
    };

    for (const p of all) {
      const rs = getBuiltin(p.entry.ruleset);
      expect(rs, p.id).toBeDefined();
      const sim = new Simulation({ ruleset: { ...rs!, boundary: 'infinite' } });
      for (const c of p.decoded.cells) {
        if (c.state !== 0) sim.set(OX + c.x, OY + c.y, c.state);
      }
      const pad = p.entry.category === 'gun' ? 96 : 64;
      const box = () =>
        liveCells(sim, OX - pad, OY - pad, OX + p.entry.width + pad, OY + p.entry.height + pad);
      const start = box();
      const startKey = keyOf(start);

      if (p.entry.category === 'still-life') {
        if (p.entry.period !== 1) report(p.id, `still-life period ${p.entry.period}`);
        sim.step();
        if (keyOf(box()) !== startKey) report(p.id, 'still-life moved after 1 gen');
        continue;
      }

      if (p.entry.category === 'oscillator') {
        if (!p.entry.period || p.entry.period < 2) report(p.id, `oscillator period ${p.entry.period}`);
        let firstRepeat = 0;
        const limit = p.entry.period ?? 0;
        for (let i = 1; i <= limit; i++) {
          sim.step();
          if (keyOf(box()) === startKey) {
            firstRepeat = i;
            break;
          }
        }
        if (firstRepeat !== p.entry.period) {
          report(p.id, `first-repeat ${firstRepeat || 'none'} declared ${p.entry.period}`);
        }
        continue;
      }

      if (p.entry.category === 'spaceship') {
        if (!p.entry.period || !p.entry.speed) {
          report(p.id, `spaceship missing period/speed`);
          continue;
        }
        for (let i = 0; i < p.entry.period; i++) sim.step();
        const after = box();
        const disp = findDisp(start, after);
        if (!disp) {
          report(p.id, `did not translate after ${p.entry.period} gens (start ${start.length} after ${after.length})`);
          continue;
        }
        const [dx, dy] = disp;
        const speed = p.entry.speed;
        const period = p.entry.period ?? 0;
        if (speed === 'c/4 diagonal') {
          const step = period / 4;
          if (!(Math.abs(dx) === step && Math.abs(dy) === step)) {
            report(p.id, `c/4 diagonal but disp (${dx},${dy}) period ${period}`);
          }
        } else if (speed === 'c/2 orthogonal') {
          const step = period / 2;
          if (!((Math.abs(dx) === step && dy === 0) || (dx === 0 && Math.abs(dy) === step))) {
            report(p.id, `c/2 orthogonal but disp (${dx},${dy}) period ${period}`);
          }
        } else if (speed === 'c/4 orthogonal') {
          const step = period / 4;
          if (!((Math.abs(dx) === step && dy === 0) || (dx === 0 && Math.abs(dy) === step))) {
            report(p.id, `c/4 orthogonal but disp (${dx},${dy}) period ${period}`);
          }
        } else if (speed === 'c orthogonal') {
          if (!((Math.abs(dx) === period && dy === 0) || (dx === 0 && Math.abs(dy) === period))) {
            report(p.id, `c orthogonal but disp (${dx},${dy}) period ${period}`);
          }
        } else {
          report(p.id, `unrecognised speed "${speed}" (${dx},${dy})`);
        }
        continue;
      }

      if (p.entry.category === 'gun') {
        if (!p.entry.period) {
          report(p.id, 'gun missing period');
          continue;
        }
        for (let i = 0; i < p.entry.period; i++) sim.step();
        if (box().length <= start.length) report(p.id, `gun population did not grow after ${p.entry.period}`);
      }
    }
    expect(failures, failures.join('\n')).toEqual([]);
  });

  it('the HighLife seed is present and unique to that ruleset', () => {
    const p = all.find((x) => x.id === 'highlife-seed');
    expect(p).toBeDefined();
    expect(p!.entry.ruleset).toBe('highlife');
    expect(p!.entry.category).toBe('seed');
  });
});

describe('patterns/ directory listing (legacy normalize path)', () => {
  it('still finds .rle files at the catalogue root', () => {
    const files = readdirSync(PATTERNS).filter((f) => f.endsWith('.rle'));
    expect(files.length).toBeGreaterThanOrEqual(200);
  });
});
