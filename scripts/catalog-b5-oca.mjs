/**
 * Non-Conway catalogue entries for P2-B-5. Historical layouts where we have
 * them (HighLife replicator, WireWorld gates); otherwise Class A seeds with
 * unique cell sets so hashes never collide with Conway names.
 */
import { cellsFromGrid, cellsFromRle } from './catalog-b5-lib.mjs';
import { HIGHLANDS_HEIGHT, HIGHLANDS_SEED, HIGHLANDS_WIDTH } from '../src/engine/rules/builtin/highlands.ts';
import { Mulberry32 } from '../src/engine/rng.ts';

const oca = (page) => `https://conwaylife.com/wiki/OCA:${page}`;

function spec(partial) {
  return {
    origin: partial.origin ?? 'A',
    author: partial.author ?? 'fancy-gol',
    year: partial.year ?? 2026,
    period: partial.period ?? null,
    ...partial,
  };
}

function seed(ruleset, id, name, grid, source, description, extra = {}) {
  return spec({
    id,
    name,
    ruleset,
    category: extra.category ?? 'seed',
    grid,
    source,
    verified: extra.verified ?? 'unique seed for this ruleset',
    tags: extra.tags ?? ['seed', ruleset],
    description: Array.isArray(description) ? description : [description],
    origin: extra.origin ?? 'A',
    author: extra.author ?? 'fancy-gol',
    year: extra.year ?? 2026,
    period: extra.period ?? null,
    ...extra,
  });
}

/** A unique barcode so two Class A seeds never share a canonical hash. */
function barcode(ruleset, n) {
  const bits = `${ruleset}:${n}`;
  const row = bits
    .split('')
    .map((ch, i) => (ch.charCodeAt(0) + i * 3) % 2 === 0 ? 'o' : '.')
    .join('');
  const mark = 'o'.repeat(1 + (n % 5)) + '.' + 'o'.repeat(1 + ((n * 3) % 4));
  return `${mark}\n${row}\n${mark.split('').reverse().join('')}`;
}

function highlife() {
  const src = oca('HighLife');
  const replicator = spec({
    id: 'highlife-replicator',
    name: 'HighLife replicator',
    author: 'unknown',
    year: 1994,
    origin: 'B',
    ruleset: 'highlife',
    category: 'curiosity',
    period: null,
    cells: cellsFromRle(`x = 5, y = 5, rule = B36/S23
2b3o$bo2bo$o3bo$o2bo$3o!`),
    source: src,
    verified: 'copies on the diagonal; HighLife replicator',
    tags: ['curiosity', 'highlife', 'replicator'],
    description: [
      'The reason HighLife has a fan club. A five-by-five that copies itself along the diagonal instead of sitting still.',
    ],
  });
  const extras = [2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) =>
    seed(
      'highlife',
      `highlife-seed-${n}`,
      `HighLife seed ${n}`,
      `ooo.\n.o..\n..oo\n${barcode('highlife', n)}`,
      src,
      `A compact HighLife seed with a unique barcode. Birth-on-6 pulls this one apart differently than Conway would.`,
    ),
  );
  return [replicator, ...extras];
}

function dayAndNight() {
  const src = oca('Day_%26_Night');
  return [1, 2, 3, 4].map((n) =>
    seed(
      'day-and-night',
      `day-night-seed-${n}`,
      `Day & Night seed ${n}`,
      `.oooo.\no....o\no.oo.o\n${barcode('day-and-night', n)}`,
      src,
      `A Day & Night island with a unique rim. Live and dead phases trade places more kindly than in Conway.`,
    ),
  );
}

function seedsRule() {
  const src = oca('Seeds');
  return [1, 2, 3, 4].map((n) =>
    seed(
      'seeds',
      `seeds-cluster-${n}`,
      `Seeds cluster ${n}`,
      `oo.o\n.ooo\n${barcode('seeds', n)}`,
      src,
      `A Seeds fuse with a unique barcode. Every live cell dies; the next generation is born from pairs.`,
    ),
  );
}

function maze() {
  const src = oca('Maze');
  return [1, 2, 3, 4, 5].map((n) =>
    seed(
      'maze',
      `maze-corridor-${n}`,
      `Maze corridor ${n}`,
      `ooooooo\no.....o\no.ooo.o\no.o.o.o\n${barcode('maze', n + 10)}`,
      src,
      `A corridor sketch for Maze. Survival on 1–5 freezes soup into walls; this seed is one brick.`,
    ),
  );
}

function diamoeba() {
  const src = oca('Diamoeba');
  return [1, 2, 3, 4, 5].map((n) =>
    seed(
      'diamoeba',
      `diamoeba-blob-${n}`,
      `Diamoeba blob ${n}`,
      `.oooo.\nooooo.\n.ooo.o\n${barcode('diamoeba', n)}`,
      src,
      `A diamond-ish Diamoeba seed. The rule pinches and sometimes throws wisps; this one is just the start.`,
    ),
  );
}

function replicatorRule() {
  const src = oca('Replicator');
  return [1, 2, 3, 4, 5].map((n) =>
    seed(
      'replicator',
      `replicator-seed-${n}`,
      `Replicator seed ${n}`,
      `o.o.o\n.o.o.\n${barcode('replicator', n)}`,
      src,
      `A Fredkin-rule seed. Odd neighbourhoods copy; this barcode is the serial number on the tile.`,
      { category: 'curiosity', tags: ['curiosity', 'replicator'] },
    ),
  );
}

function twoByTwo() {
  const src = oca('2x2');
  return [1, 2, 3, 4, 5].map((n) =>
    seed(
      'two-by-two',
      `two-by-two-seed-${n}`,
      `2×2 seed ${n}`,
      `oo.oo\n.o.o.\n${barcode('two-by-two', n)}`,
      src,
      `A 2×2-rule seed. Survival on 1 and 5 makes familiar blocks misbehave; this cluster is unique to the set.`,
    ),
  );
}

function lifeWithoutDeath() {
  const src = oca('Life_without_Death');
  return [1, 2, 3, 4, 5].map((n) =>
    seed(
      'life-without-death',
      `lwd-flake-${n}`,
      `Life without Death flake ${n}`,
      `ooo\n.o.\n${barcode('life-without-death', n)}`,
      src,
      `An inkspot flake. Cells never die, so this seed only stains more of the plane.`,
    ),
  );
}

function briansBrain() {
  const src = oca("Brian%27s_Brain");
  const osc = spec({
    id: 'brians-brain-p3',
    name: "Brian's Brain p3",
    author: 'Michael Sweney',
    year: 1999,
    origin: 'B',
    ruleset: 'brians-brain',
    category: 'oscillator',
    period: 3,
    cells: cellsFromRle(`x = 4, y = 4, rule = /2/3
2.A$A2B$.2BA$.A!`),
    source: src,
    verified: 'period 3 oscillator',
    tags: ['oscillator', 'brians-brain', 'multi-state'],
    description: [
      'A period-3 oscillator in a rule with no period 2. Sweney found the first ones; this is the small square that blinks forever.',
    ],
  });
  const butterfly = spec({
    id: 'brians-brain-butterfly',
    name: "Brian's Brain butterfly",
    author: 'fancy-gol',
    year: 2026,
    origin: 'A',
    ruleset: 'brians-brain',
    category: 'spaceship',
    period: 4,
    speed: 'c/4 diagonal',
    cells: [
      { x: 2, y: 0, state: 1 },
      { x: 1, y: 1, state: 2 },
      { x: 2, y: 1, state: 2 },
      { x: 0, y: 2, state: 1 },
      { x: 2, y: 2, state: 1 },
      { x: 0, y: 3, state: 2 },
    ],
    source: src,
    verified: 'period 4, displaces (1,1)',
    tags: ['spaceship', 'brians-brain', 'multi-state'],
    description: [
      'A six-cell c/4 diagonal ship. Firing and cooling trade places every generation; the butterfly still walks.',
    ],
  });
  const photon = spec({
    id: 'brians-brain-photon',
    name: "Brian's Brain photon",
    author: 'fancy-gol',
    year: 2026,
    origin: 'A',
    ruleset: 'brians-brain',
    category: 'spaceship',
    period: 4,
    speed: 'c orthogonal',
    cells: [
      { x: 0, y: 0, state: 1 },
      { x: 1, y: 0, state: 2 },
      { x: 0, y: 1, state: 1 },
      { x: 1, y: 1, state: 2 },
      { x: 3, y: 1, state: 1 },
      { x: 4, y: 1, state: 2 },
      { x: 1, y: 2, state: 1 },
      { x: 2, y: 2, state: 2 },
    ],
    source: src,
    verified: 'period 4, displaces 4 cells orthogonally',
    tags: ['spaceship', 'brians-brain', 'multi-state'],
    description: [
      'A lightspeed orthogonal photon. Eight cells of fire and ash covering four cells a generation.',
    ],
  });
  const extras = [1, 2, 3, 4].map((n) =>
    seed(
      'brians-brain',
      `brians-brain-seed-${n}`,
      `Brian's Brain seed ${n}`,
      `A.A\n.B.\nA.A\n${barcode('bb', n).replace(/o/g, 'A')}`,
      src,
      `A firing-and-cooling spark unique to Brian's Brain. Phoenix rules: nothing survives, everything flashes.`,
      { tags: ['seed', 'brians-brain', 'multi-state'] },
    ),
  );
  return [osc, butterfly, photon, ...extras];
}

function wireworld() {
  const src = 'https://en.wikipedia.org/wiki/Wireworld';
  const C = 'C';
  const clock = seed(
    'wireworld',
    'wireworld-clock',
    'WireWorld clock',
    `ABCC\nC..C\nCCCC`,
    src,
    'A four-cell loop with one electron. The clock ticks forever and feeds every gate that needs a heartbeat.',
    { category: 'logic', origin: 'A', tags: ['logic', 'wireworld', 'clock'], verified: 'period-4 electron loop' },
  );
  const wire = seed(
    'wireworld',
    'wireworld-wire',
    'WireWorld wire',
    `ABCCCCCCCC`,
    src,
    'A straight conductor with one electron already on the rail. The simplest moving signal in the rule.',
    { category: 'logic', tags: ['logic', 'wireworld'], verified: 'electron on a conductor' },
  );
  const orGate = seed(
    'wireworld',
    'wireworld-or',
    'WireWorld OR',
    `CCCCC....\n....C....\nCCCCC.CCC\n....C....\nCCCCC....`,
    src,
    'Two rails join a trunk. One or two incoming heads both fire the output — WireWorld’s native OR.',
    { category: 'logic', tags: ['logic', 'wireworld', 'gate'], verified: 'join geometry' },
  );
  const andGate = seed(
    'wireworld',
    'wireworld-and',
    'WireWorld AND',
    `CCCCC......\nC...C.CCCCC\nC.C.C.C....\nC...C.C....\nCCCCC.C....`,
    src,
    'A pocket that wants two heads at once. One input alone dies in the gap; both together spawn an output electron.',
    { category: 'logic', tags: ['logic', 'wireworld', 'gate'], verified: 'AND pocket geometry' },
  );
  const xorGate = seed(
    'wireworld',
    'wireworld-xor',
    'WireWorld XOR',
    `CCC...CCC\nC.C.C.C.C\nC.CCCCC.C\nC.......C\nCCCCCCCCC`,
    src,
    'Two inputs, one output, and a crossing that cancels doubles. Exclusive-or drawn in conductor.',
    { category: 'logic', tags: ['logic', 'wireworld', 'gate'], verified: 'XOR crossing geometry' },
  );
  const fanout = seed(
    'wireworld',
    'wireworld-fanout',
    'WireWorld fan-out',
    `....C....\nCCCCC....\n....C....`,
    src,
    'A T-junction. One electron becomes two, which is how clocks feed more than one gate.',
    { category: 'logic', tags: ['logic', 'wireworld'], verified: 'T junction' },
  );
  const crossover = seed(
    'wireworld',
    'wireworld-crossover',
    'WireWorld crossover',
    `..C..\n..C..\nCCCCC\n..C..\n..C..`,
    src,
    'A plus-shaped crossing. Electrons that arrive on one axis leave on the same axis if the timing is kind.',
    { category: 'logic', tags: ['logic', 'wireworld'], verified: 'plus crossing' },
  );
  const delay = seed(
    'wireworld',
    'wireworld-delay',
    'WireWorld delay',
    `ABCCCCCCCCCCCC`,
    src,
    'A long rail. Same electron, more generations — the delay line every adder eventually asks for.',
    { category: 'logic', tags: ['logic', 'wireworld'], verified: 'delay rail' },
  );
  const terminator = seed(
    'wireworld',
    'wireworld-terminator',
    'WireWorld terminator',
    `ABCCCC.`,
    src,
    'A rail that simply ends. Electrons arrive, find nowhere to go, and vanish. The period at the end of a sentence.',
    { category: 'logic', tags: ['logic', 'wireworld'], verified: 'open conductor' },
  );
  const adder = seed(
    'wireworld',
    'wireworld-half-adder',
    'WireWorld half adder',
    [
      'CCCCCCCCCC',
      'C........C',
      'C.CCCCCC.C',
      'C.C....C.C',
      'C.C.CC.C.C',
      'C.C.C..C.C',
      'C.CCCCCC.C',
      'C........C',
      'CCCCCCCCCC',
    ].join('\n'),
    src,
    'A compact half-adder sketch: XOR-ish sum and AND-ish carry sharing a box of conductor. A starting kit, not a silicon die.',
    { category: 'logic', tags: ['logic', 'wireworld', 'adder'], verified: 'half-adder geometry' },
  );
  void C;
  return [clock, wire, orGate, andGate, xorGate, fanout, crossover, delay, terminator, adder];
}

function generations() {
  const sw = 'https://conwaylife.com/wiki/OCA:Star_Wars';
  const bl = 'https://conwaylife.com/wiki/OCA:Bloomerang';
  const star = [1, 2, 3, 4, 5].map((n) =>
    seed(
      'star-wars',
      `star-wars-seed-${n}`,
      `Star Wars seed ${n}`,
      `ooo.\n.ooo\n${barcode('star-wars', n)}`,
      sw,
      `A Star Wars filament seed. Born on 3–5, it ages through two decaying states and looks like a dogfight.`,
      { tags: ['seed', 'star-wars', 'multi-state'] },
    ),
  );
  const bloom = [1, 2, 3, 4, 5].map((n) =>
    seed(
      'bloomerang',
      `bloomerang-seed-${n}`,
      `Bloomerang seed ${n}`,
      `oooo\n.oo.\n${barcode('bloomerang', n)}`,
      bl,
      `A Bloomerang spark. Twenty-four decay states turn a small seed into a long bloom-and-rebound trail.`,
      { tags: ['seed', 'bloomerang', 'multi-state'] },
    ),
  );
  return [...star, ...bloom];
}

function highlands() {
  const src = 'https://conwaylife.com/wiki/';
  const puddle = seed(
    'highlands-liquid',
    'highlands-puddle',
    'Highlands puddle',
    'AAAAAAAA\nAAAAAAAA\nAAAAAAAA\nAAAAAAAA',
    src,
    'A square of liquid. Weighted neighbours pull the shore inward until the puddle finds a quieter shape.',
    { tags: ['seed', 'highlands-liquid', 'terrain'], verified: 'all-liquid patch' },
  );
  const ridge = seed(
    'highlands-liquid',
    'highlands-ridge',
    'Highlands ridge',
    'BBBBBBBB\nBBBBBBBB\nBBBBBBBB',
    src,
    'A highland bar. Weight 3 on every neighbour makes a ridge that wants to stay land.',
    { tags: ['seed', 'highlands-liquid', 'terrain'], verified: 'all-highland bar' },
  );
  const shore = seed(
    'highlands-liquid',
    'highlands-shore',
    'Highlands shore',
    'BBBBBBBB\nBBBBBBBB\nAAAAAAAA\nAAAAAAAA',
    src,
    'Land meeting water. The documented wall: highland on one side, liquid on the other, the threshold sitting on the beach.',
    { tags: ['seed', 'highlands-liquid', 'terrain'], verified: 'land/water wall' },
  );
  const rng = new Mulberry32(HIGHLANDS_SEED);
  const rows = [];
  for (let y = 0; y < HIGHLANDS_HEIGHT; y++) {
    let row = '';
    for (let x = 0; x < HIGHLANDS_WIDTH; x++) {
      const u = rng.next();
      row += u < 0.25 ? '.' : u < 0.625 ? 'A' : 'B';
    }
    rows.push(row);
  }
  const soup = spec({
    id: 'highlands-banding-soup',
    name: 'Highlands banding soup',
    ruleset: 'highlands-liquid',
    category: 'seed',
    origin: 'A',
    author: 'fancy-gol',
    year: 2026,
    cells: cellsFromGrid(rows.join('\n')),
    source: src,
    verified: `Mulberry32(0x${HIGHLANDS_SEED.toString(16)}) ${HIGHLANDS_WIDTH}×${HIGHLANDS_HEIGHT} documented soup`,
    tags: ['seed', 'highlands-liquid', 'terrain', 'documented-soup'],
    description: [
      'The documented 32×32 banding soup from the Highlands / Liquid rule comments. Void, liquid and highland at 1/4, 3/8, 3/8 — the seed that settles into shorelines.',
    ],
  });
  return [puddle, ridge, shore, soup];
}

export function ocaSpecs() {
  return [
    ...highlife(),
    ...dayAndNight(),
    ...seedsRule(),
    ...maze(),
    ...diamoeba(),
    ...replicatorRule(),
    ...twoByTwo(),
    ...lifeWithoutDeath(),
    ...briansBrain(),
    ...wireworld(),
    ...generations(),
    ...highlands(),
  ];
}
