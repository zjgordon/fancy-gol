/**
 * Parses classic Life-family rule notation strings into a `RuleSet`, and formats one back —
 * one entry point that sniffs the format rather than requiring the caller to know it.
 *
 * Supported:
 *  - B/S:              "B3/S23", "b3/s23"
 *  - S/B (Golly legacy):"23/3"
 *  - Generations:       "B3/S23/G3", "3/4/5" (Golly order: survive/born/states), "/2/3"
 *  - Neighbourhood suffix on the whole string: "V" (von Neumann r1), "H" (hex) — e.g. "B2/S34H"
 *
 * Not supported (rejected explicitly, not mis-parsed): Hensel/non-totalistic notation
 * ("B2ci/S12"), where letters appear attached to specific neighbour-count digits.
 */
import type { Neighborhood, RuleSet, StateDef, TransitionSpec } from '../types';
import { RuleValidationError } from './errors';

const SUPPORTED_FORMS = [
  'B<digits>/S<digits> (e.g. "B3/S23")',
  '<survive>/<born> legacy (e.g. "23/3")',
  'B<digits>/S<digits>/G<n> (e.g. "B3/S23/G3")',
  '<survive>/<born>/<states> Golly order (e.g. "3/4/5", "/2/3")',
  'a trailing V (von Neumann) or H (hex) neighbourhood suffix on any of the above',
].join('; ');

function unsupported(input: string, reason: string): never {
  throw new RuleValidationError([
    {
      path: '',
      message: `could not parse rule notation "${input}": ${reason}`,
      hint: `supported forms: ${SUPPORTED_FORMS}`,
    },
  ]);
}

function digitsOf(segment: string): number[] {
  return segment === '' ? [] : segment.split('').map((c) => Number.parseInt(c, 10));
}

function isDigitsOnly(segment: string): boolean {
  return /^\d*$/.test(segment);
}

interface ParsedCore {
  readonly born: readonly number[];
  readonly survive: readonly number[];
  readonly states: number; // 2 for plain totalistic, >=2 for generations
  readonly isGenerations: boolean;
}

function parseCore(body: string, original: string): ParsedCore {
  const segments = body.split('/');

  const looksLetterPrefixed =
    segments.length >= 2 && /^[bB]/.test(segments[0] ?? '') && /^[sS]/.test(segments[1] ?? '');

  if (looksLetterPrefixed) {
    if (segments.length > 3) unsupported(original, `too many "/"-separated segments (${segments.length})`);
    const bornRaw = (segments[0] ?? '').slice(1);
    const surviveRaw = (segments[1] ?? '').slice(1);
    if (!isDigitsOnly(bornRaw)) {
      unsupported(original, `"${segments[0]}" mixes letters into the born digits — Hensel/non-totalistic notation is not supported until Phase 2`);
    }
    if (!isDigitsOnly(surviveRaw)) {
      unsupported(original, `"${segments[1]}" mixes letters into the survive digits — Hensel/non-totalistic notation is not supported until Phase 2`);
    }
    const born = digitsOf(bornRaw);
    const survive = digitsOf(surviveRaw);

    if (segments.length === 3) {
      const gSeg = segments[2] ?? '';
      if (!/^[gG]\d+$/.test(gSeg)) {
        unsupported(original, `"${gSeg}" is not a valid G<n> generations segment`);
      }
      return { born, survive, states: Number.parseInt(gSeg.slice(1), 10), isGenerations: true };
    }
    return { born, survive, states: 2, isGenerations: false };
  }

  // No B/S letters anywhere: the legacy all-digit forms.
  const allDigitSegments = segments.every(isDigitsOnly);
  if (!allDigitSegments) {
    unsupported(original, 'segments mix letters and digits in a form that is neither "B../S.." nor a recognised legacy digit form');
  }

  if (segments.length === 2) {
    const [surviveRaw, bornRaw] = segments as [string, string];
    return { born: digitsOf(bornRaw), survive: digitsOf(surviveRaw), states: 2, isGenerations: false };
  }
  if (segments.length === 3) {
    const [surviveRaw, bornRaw, statesRaw] = segments as [string, string, string];
    if (statesRaw === '') unsupported(original, 'the states segment of a Golly-order generations rule cannot be empty');
    return {
      born: digitsOf(bornRaw),
      survive: digitsOf(surviveRaw),
      states: Number.parseInt(statesRaw, 10),
      isGenerations: true,
    };
  }
  unsupported(original, `expected 2 or 3 "/"-separated segments, got ${segments.length}`);
}

function buildStates(n: number): StateDef[] {
  const states: StateDef[] = [{ id: 0, name: 'dead', kind: 'dead', countsAsAlive: false }];
  states.push({ id: 1, name: 'alive', kind: 'live', countsAsAlive: true });
  for (let id = 2; id < n; id++) {
    states.push({ id, name: `generation-${id}`, kind: 'decay', countsAsAlive: false });
  }
  return states;
}

function neighborhoodForSuffix(suffix: 'V' | 'H' | null): Neighborhood {
  if (suffix === 'V') return { kind: 'vonNeumann', radius: 1 };
  if (suffix === 'H') return { kind: 'hex' };
  return { kind: 'moore', radius: 1 };
}

/** Parse a Life-family rule notation string into a complete, ready-to-compile `RuleSet`. */
export function parseRuleNotation(input: string): RuleSet {
  const raw = input.trim();
  if (raw.length === 0) unsupported(input, 'the input is empty');

  let suffix: 'V' | 'H' | null = null;
  let body = raw;
  const lastChar = raw[raw.length - 1] ?? '';
  const beforeLast = raw[raw.length - 2] ?? '';
  if (/^[vh]$/i.test(lastChar) && /\d/.test(beforeLast)) {
    suffix = lastChar.toUpperCase() as 'V' | 'H';
    body = raw.slice(0, -1);
  }

  const core = parseCore(body, raw);
  const neighborhood = neighborhoodForSuffix(suffix);
  const states = buildStates(core.states);
  const transition: TransitionSpec = core.isGenerations
    ? { kind: 'generations', born: [...core.born], survive: [...core.survive], states: core.states }
    : { kind: 'totalistic', born: [...core.born], survive: [...core.survive] };

  const name = formatCore(core, suffix);
  return { id: name, name, states, neighborhood, transition, boundary: 'toroidal' };
}

function formatCore(core: ParsedCore, suffix: 'V' | 'H' | null): string {
  const born = [...core.born].sort((a, b) => a - b).join('');
  const survive = [...core.survive].sort((a, b) => a - b).join('');
  let out = `B${born}/S${survive}`;
  if (core.isGenerations) out += `/G${core.states}`;
  if (suffix) out += suffix;
  return out;
}

/** Format a `RuleSet` produced by (or shaped like) `parseRuleNotation` back to canonical notation. */
export function formatRuleNotation(rs: RuleSet): string {
  if (rs.transition.kind !== 'totalistic' && rs.transition.kind !== 'generations') {
    throw new RuleValidationError([
      {
        path: '/transition/kind',
        message: `formatRuleNotation only supports totalistic and generations rules, got "${rs.transition.kind}"`,
      },
    ]);
  }
  const isGenerations = rs.transition.kind === 'generations';
  const core: ParsedCore = {
    born: rs.transition.born,
    survive: rs.transition.survive,
    states: isGenerations ? (rs.transition as { states: number }).states : 2,
    isGenerations,
  };
  let suffix: 'V' | 'H' | null = null;
  if (rs.neighborhood.kind === 'vonNeumann' && rs.neighborhood.radius === 1) suffix = 'V';
  else if (rs.neighborhood.kind === 'hex') suffix = 'H';
  return formatCore(core, suffix);
}
