/**
 * The studio's single document model (P2-E-2). Form chips, the notation
 * string, and the JSON editor all read and write this shape. Canonicalise
 * after every edit so the three views cannot drift.
 *
 * `ui/` cannot import `@engine` (ADR-009). Notation parse/format here covers
 * the Life-family B/S(/G)(+V/H) subset the form edits; the composition root
 * still validates the full document with `validateRuleSet`.
 */
import { neighborCount, type StudioNeighborhood } from './offsets';

export const STUDIO_SCHEMA_VERSION = 1;

export type StateKind = 'dead' | 'live' | 'decay' | 'inert';
export type BoundaryKind = 'bounded' | 'toroidal' | 'infinite';
export type TransitionKind = 'totalistic' | 'generations';
export type Temperament = 'explosive' | 'chaotic' | 'stable' | 'maze-like';

export interface StudioState {
  readonly id: number;
  readonly name: string;
  readonly kind: StateKind;
  readonly countsAsAlive: boolean;
}

export interface StudioTransition {
  readonly kind: TransitionKind;
  readonly born: readonly number[];
  readonly survive: readonly number[];
  readonly states?: number;
  readonly decayStates?: number;
}

export interface StudioDocument {
  readonly version: number;
  readonly id: string;
  readonly name: string;
  readonly description?: string;
  readonly author?: string;
  readonly year?: number;
  readonly tags?: readonly string[];
  readonly notation?: string;
  readonly states: readonly StudioState[];
  readonly neighborhood: StudioNeighborhood;
  readonly transition: StudioTransition;
  readonly boundary: BoundaryKind;
}

export type Rng = () => number;

export interface RandomiseOptions {
  readonly birthDensity: number;
  readonly surviveDensity: number;
  /** 0–1: chance each chosen count is mirrored to N−k (chip-row symmetry). */
  readonly symmetry: number;
}

export const DEFAULT_RANDOMISE: RandomiseOptions = {
  birthDensity: 0.28,
  surviveDensity: 0.34,
  symmetry: 0.35,
};

const STATE_KINDS = new Set<StateKind>(['dead', 'live', 'decay', 'inert']);
const BOUNDARIES = new Set<BoundaryKind>(['bounded', 'toroidal', 'infinite']);

export function uniqueSorted(values: readonly number[]): number[] {
  return [...new Set(values.filter((n) => Number.isInteger(n)))].sort((a, b) => a - b);
}

export function formatNotation(doc: StudioDocument): string {
  const born = uniqueSorted(doc.transition.born).join('');
  const survive = uniqueSorted(doc.transition.survive).join('');
  let out = `B${born}/S${survive}`;
  if (doc.transition.kind === 'generations') {
    const n = doc.transition.states ?? doc.states.length;
    out += `/G${String(n)}`;
  }
  if (doc.neighborhood.kind === 'vonNeumann' && (doc.neighborhood.radius ?? 1) === 1) out += 'V';
  else if (doc.neighborhood.kind === 'hex') out += 'H';
  return out;
}

export function parseNotation(input: string): {
  born: number[];
  survive: number[];
  generations: number | null;
  suffix: 'V' | 'H' | null;
} | null {
  const raw = input.trim();
  if (raw.length === 0) return null;
  let suffix: 'V' | 'H' | null = null;
  let body = raw;
  const last = raw[raw.length - 1] ?? '';
  const before = raw[raw.length - 2] ?? '';
  if (/^[vh]$/i.test(last) && /\d/.test(before)) {
    suffix = last.toUpperCase() as 'V' | 'H';
    body = raw.slice(0, -1);
  }
  const parts = body.split('/');
  if (parts.length < 2 || parts.length > 3) return null;
  const bPart = parts[0] ?? '';
  const sPart = parts[1] ?? '';
  if (!/^[bB]\d*$/.test(bPart) || !/^[sS]\d*$/.test(sPart)) return null;
  const born = uniqueSorted(bPart.slice(1).split('').map((c) => Number(c)));
  const survive = uniqueSorted(sPart.slice(1).split('').map((c) => Number(c)));
  let generations: number | null = null;
  if (parts.length === 3) {
    const g = parts[2] ?? '';
    if (!/^[gG]\d+$/.test(g)) return null;
    generations = Number.parseInt(g.slice(1), 10);
    if (!(generations >= 2)) return null;
  }
  return { born, survive, generations, suffix };
}

export function neighborMax(doc: StudioDocument): number {
  return neighborCount(doc.neighborhood);
}

function clampCounts(counts: readonly number[], max: number): number[] {
  return uniqueSorted(counts).filter((n) => n >= 0 && n <= max);
}

export function canonicalize(doc: StudioDocument): StudioDocument {
  const max = neighborMax(doc);
  const born = clampCounts(doc.transition.born, max);
  const survive = clampCounts(doc.transition.survive, max);
  const states = doc.states.map((s, i) => ({
    id: i,
    name: s.name.trim() || `state-${String(i)}`,
    kind: i === 0 ? ('dead' as const) : s.kind === 'dead' ? ('live' as const) : s.kind,
    countsAsAlive: i === 0 ? false : s.countsAsAlive,
  }));
  const transition: StudioTransition =
    doc.transition.kind === 'generations'
      ? {
          kind: 'generations',
          born,
          survive,
          states: Math.max(2, doc.transition.states ?? states.length),
        }
      : {
          kind: 'totalistic',
          born,
          survive,
          ...(doc.transition.decayStates !== undefined ? { decayStates: doc.transition.decayStates } : {}),
        };
  const next: StudioDocument = {
    ...doc,
    version: STUDIO_SCHEMA_VERSION,
    states,
    transition,
    notation: formatNotation({ ...doc, states, transition }),
  };
  return next;
}

export function applyNotation(doc: StudioDocument, input: string): StudioDocument | null {
  const parsed = parseNotation(input);
  if (!parsed) return null;
  let neighborhood = doc.neighborhood;
  if (parsed.suffix === 'V') neighborhood = { kind: 'vonNeumann', radius: 1 };
  else if (parsed.suffix === 'H') neighborhood = { kind: 'hex' };
  else if (doc.neighborhood.kind === 'vonNeumann' || doc.neighborhood.kind === 'hex') {
    neighborhood = { kind: 'moore', radius: 1 };
  }
  let states = doc.states;
  let transition: StudioTransition;
  if (parsed.generations !== null) {
    while (states.length < parsed.generations) {
      states = [
        ...states,
        {
          id: states.length,
          name: `generation-${String(states.length)}`,
          kind: 'decay',
          countsAsAlive: false,
        },
      ];
    }
    transition = { kind: 'generations', born: parsed.born, survive: parsed.survive, states: parsed.generations };
  } else {
    transition = { kind: 'totalistic', born: parsed.born, survive: parsed.survive };
  }
  return canonicalize({ ...doc, neighborhood, states, transition });
}

export function toggleCount(counts: readonly number[], n: number): number[] {
  const set = new Set(counts);
  if (set.has(n)) set.delete(n);
  else set.add(n);
  return uniqueSorted([...set]);
}

export function applyBornSurvive(
  doc: StudioDocument,
  field: 'born' | 'survive',
  counts: readonly number[],
): StudioDocument {
  return canonicalize({
    ...doc,
    transition: { ...doc.transition, [field]: counts },
  });
}

export function applyNeighborhood(doc: StudioDocument, neighborhood: StudioNeighborhood): StudioDocument {
  return canonicalize({ ...doc, neighborhood });
}

export function applyStates(doc: StudioDocument, states: readonly StudioState[]): StudioDocument {
  return canonicalize({ ...doc, states });
}

const DEFAULT_STATES: readonly StudioState[] = [
  { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
  { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
];

export function emptyLifeDocument(): StudioDocument {
  return canonicalize({
    version: STUDIO_SCHEMA_VERSION,
    id: 'studio',
    name: 'Untitled rule',
    states: DEFAULT_STATES,
    neighborhood: { kind: 'moore', radius: 1 },
    transition: { kind: 'totalistic', born: [3], survive: [2, 3] },
    boundary: 'toroidal',
  });
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function readStates(raw: unknown): StudioState[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const states: StudioState[] = [];
  for (let i = 0; i < raw.length; i++) {
    const row = asRecord(raw[i]);
    if (!row) return null;
    const id = typeof row['id'] === 'number' ? row['id'] : i;
    const name = typeof row['name'] === 'string' ? row['name'] : `state-${String(i)}`;
    const kind = STATE_KINDS.has(row['kind'] as StateKind) ? (row['kind'] as StateKind) : i === 0 ? 'dead' : 'live';
    const countsAsAlive = typeof row['countsAsAlive'] === 'boolean' ? row['countsAsAlive'] : i !== 0;
    states.push({ id, name, kind, countsAsAlive });
  }
  return states;
}

function readNeighborhood(raw: unknown): StudioNeighborhood | null {
  const row = asRecord(raw);
  if (!row) return null;
  const kind = row['kind'];
  if (kind === 'moore' || kind === 'vonNeumann') {
    const radius = typeof row['radius'] === 'number' && row['radius'] >= 1 ? row['radius'] : 1;
    return { kind, radius };
  }
  if (kind === 'hex') return { kind: 'hex' };
  if (kind === 'custom') {
    const offsets: Array<readonly [number, number]> = [];
    if (Array.isArray(row['offsets'])) {
      for (const pair of row['offsets']) {
        if (Array.isArray(pair) && pair.length === 2 && typeof pair[0] === 'number' && typeof pair[1] === 'number') {
          offsets.push([pair[0], pair[1]]);
        }
      }
    }
    return { kind: 'custom', offsets };
  }
  return null;
}

function readInts(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || !raw.every((n) => typeof n === 'number' && Number.isInteger(n))) return null;
  return raw as number[];
}

/** Pull a form-editable document from validated (or at least parsed) JSON. */
export function documentFromUnknown(value: unknown): StudioDocument | null {
  const row = asRecord(value);
  if (!row) return null;
  const states = readStates(row['states']);
  const neighborhood = readNeighborhood(row['neighborhood']);
  const transition = asRecord(row['transition']);
  if (!states || !neighborhood || !transition) return null;
  const kind = transition['kind'];
  if (kind !== 'totalistic' && kind !== 'generations') return null;
  const born = readInts(transition['born']);
  const survive = readInts(transition['survive']);
  if (!born || !survive) return null;
  const boundary = BOUNDARIES.has(row['boundary'] as BoundaryKind)
    ? (row['boundary'] as BoundaryKind)
    : 'toroidal';
  const doc: StudioDocument = {
    version: typeof row['version'] === 'number' ? row['version'] : STUDIO_SCHEMA_VERSION,
    id: typeof row['id'] === 'string' && row['id'].length > 0 ? row['id'] : 'studio',
    name: typeof row['name'] === 'string' && row['name'].length > 0 ? row['name'] : 'Untitled rule',
    states,
    neighborhood,
    transition: {
      kind,
      born,
      survive,
      ...(kind === 'generations' && typeof transition['states'] === 'number'
        ? { states: transition['states'] }
        : {}),
      ...(typeof transition['decayStates'] === 'number' ? { decayStates: transition['decayStates'] } : {}),
    },
    boundary,
  };
  const extra: { description?: string; author?: string; year?: number; tags?: string[] } = {};
  if (typeof row['description'] === 'string') extra.description = row['description'];
  if (typeof row['author'] === 'string') extra.author = row['author'];
  if (typeof row['year'] === 'number') extra.year = row['year'];
  if (Array.isArray(row['tags']) && row['tags'].every((t) => typeof t === 'string')) extra.tags = row['tags'];
  return canonicalize({ ...doc, ...extra });
}

/** Write the form document back over the last JSON object, keeping unknown fields. */
export function mergeDocument(raw: unknown, doc: StudioDocument): unknown {
  const base = asRecord(raw) ?? {};
  const prevT = asRecord(base['transition']) ?? {};
  return {
    ...base,
    version: doc.version,
    id: doc.id,
    name: doc.name,
    ...(doc.description !== undefined ? { description: doc.description } : {}),
    ...(doc.author !== undefined ? { author: doc.author } : {}),
    ...(doc.year !== undefined ? { year: doc.year } : {}),
    ...(doc.tags !== undefined ? { tags: doc.tags } : {}),
    notation: doc.notation,
    states: doc.states,
    neighborhood: doc.neighborhood,
    transition: {
      ...prevT,
      kind: doc.transition.kind,
      born: doc.transition.born,
      survive: doc.transition.survive,
      ...(doc.transition.kind === 'generations'
        ? { states: doc.transition.states ?? doc.states.length }
        : {}),
      ...(doc.transition.decayStates !== undefined ? { decayStates: doc.transition.decayStates } : {}),
    },
    boundary: doc.boundary,
  };
}

export function viewsAgree(doc: StudioDocument, notation: string, json: unknown): boolean {
  const canonical = canonicalize(doc);
  const fromNotation = applyNotation(canonical, notation);
  const fromJson = documentFromUnknown(json);
  if (!fromNotation || !fromJson) return false;
  return (
    formatNotation(canonical) === formatNotation(fromNotation) &&
    formatNotation(canonical) === formatNotation(fromJson) &&
    sameCounts(canonical.transition.born, fromNotation.transition.born) &&
    sameCounts(canonical.transition.survive, fromNotation.transition.survive) &&
    sameCounts(canonical.transition.born, fromJson.transition.born) &&
    sameCounts(canonical.transition.survive, fromJson.transition.survive)
  );
}

function sameCounts(a: readonly number[], b: readonly number[]): boolean {
  const left = uniqueSorted(a);
  const right = uniqueSorted(b);
  return left.length === right.length && left.every((n, i) => n === right[i]);
}

/**
 * A look, not a measurement. The real {@link GrowthClassifier} needs a run;
 * this reads B/S density the way the catalogue tags rules (explosive / chaotic
 * / stable / maze-like) so Randomise can say "this one looks explosive" before
 * anyone hits Apply. E-3's test bench will confirm with the classifier.
 */
export function guessTemperament(doc: StudioDocument): Temperament {
  const max = Math.max(1, neighborMax(doc));
  const slots = max + 1;
  const birth = doc.transition.born.length / slots;
  const survive = doc.transition.survive.length / slots;
  const survivesLow = doc.transition.survive.some((n) => n <= 1);
  if (survive <= 0.15 && birth >= 0.08) return 'explosive';
  if (birth >= 0.45) return 'explosive';
  if (survivesLow && survive >= 0.45 && birth <= 0.3) return 'maze-like';
  if (birth <= 0.28 && survive >= 0.18 && survive <= 0.45) return 'stable';
  return 'chaotic';
}

export function temperamentLine(kind: Temperament): string {
  switch (kind) {
    case 'explosive':
      return 'this one looks explosive';
    case 'chaotic':
      return 'this one looks chaotic';
    case 'stable':
      return 'this one looks stable';
    case 'maze-like':
      return 'this one looks maze-like';
    default:
      return 'this one is a mystery';
  }
}

export function randomiseDocument(doc: StudioDocument, opts: RandomiseOptions, rng: Rng): StudioDocument {
  const max = neighborMax(doc);
  const birthDensity = clamp01(opts.birthDensity);
  const surviveDensity = clamp01(opts.surviveDensity);
  const symmetry = clamp01(opts.symmetry);
  const born = new Set<number>();
  const survive = new Set<number>();
  for (let n = 0; n <= max; n++) {
    if (rng() < birthDensity) born.add(n);
    if (rng() < surviveDensity) survive.add(n);
  }
  for (let n = 0; n <= max; n++) {
    if (rng() < symmetry) {
      if (born.has(n)) born.add(max - n);
      if (survive.has(n)) survive.add(max - n);
    }
  }
  const next = canonicalize({
    ...doc,
    id: 'studio-random',
    name: 'Random rule',
    transition: { ...doc.transition, born: [...born], survive: [...survive] },
  });
  return { ...next, name: formatNotation(next), id: `random-${formatNotation(next).toLowerCase()}` };
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

/** Deterministic [0, 1) generator for tests and a fair Randomise replay. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
