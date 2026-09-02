/**
 * Hand-written `RuleSetDocument` validator (no `ajv` — the no-bloat rule). Every check is
 * explicit; every failure is collected (never "stop at the first error") into one
 * {@link RuleValidationError} whose `issues` carry a real JSON-pointer `path` and a `hint` —
 * never just the word "invalid" on its own.
 */
import { compileNeighborhood } from '../neighborhood';
import type { Neighborhood } from '../types';
import { RuleValidationError, type RuleValidationIssue } from './errors';
import type { RuleSetDocument } from './schema';
import { SCHEMA_VERSION } from './schema';

const STATE_KINDS = new Set(['dead', 'live', 'decay', 'inert']);
const BOUNDARY_KINDS = new Set(['bounded', 'toroidal', 'infinite']);
const NEIGHBORHOOD_KINDS = new Set(['moore', 'vonNeumann', 'hex', 'custom']);
const TRANSITION_KINDS = new Set(['totalistic', 'generations', 'stateTable', 'weighted', 'turmite']);
const TURN_KINDS = new Set(['left', 'right', 'uturn', 'none']);

// Loosely-typed shapes for candidate JSON, named (not index-signatured) so property access
// doesn't need bracket notation under noPropertyAccessFromIndexSignature.
interface RawDoc {
  version?: unknown;
  id?: unknown;
  name?: unknown;
  description?: unknown;
  author?: unknown;
  symmetry?: unknown;
  states?: unknown;
  boundary?: unknown;
  neighborhood?: unknown;
  transition?: unknown;
}
interface RawState {
  id?: unknown;
  name?: unknown;
  kind?: unknown;
  countsAsAlive?: unknown;
}
interface RawNeighborhood {
  kind?: unknown;
  radius?: unknown;
  offsets?: unknown;
}
interface RawTransition {
  kind?: unknown;
  born?: unknown;
  survive?: unknown;
  decayStates?: unknown;
  states?: unknown;
  radix?: unknown;
  table?: unknown;
  weights?: unknown;
  thresholds?: unknown;
}
interface RawThresholdRow {
  min?: unknown;
  max?: unknown;
  toState?: unknown;
}
interface RawTurmiteRow {
  state?: unknown;
  onCellState?: unknown;
  writeState?: unknown;
  turn?: unknown;
  nextState?: unknown;
}

class IssueCollector {
  readonly issues: RuleValidationIssue[] = [];

  add(path: string, message: string, hint?: string): void {
    this.issues.push(hint === undefined ? { path, message } : { path, message, hint });
  }
}

function isPlainObject(v: unknown): v is object {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isInt(v: unknown): v is number {
  return isFiniteNumber(v) && Number.isInteger(v);
}

function isIntArray(v: unknown): v is number[] {
  return Array.isArray(v) && v.every(isInt);
}

function typeOf(v: unknown): string {
  if (v === null) return 'null';
  if (Array.isArray(v)) return 'array';
  return typeof v;
}

function checkNonEmptyString(v: unknown, path: string, issues: IssueCollector): void {
  if (typeof v !== 'string' || v.length === 0) {
    issues.add(path, 'expected a non-empty string', `got ${JSON.stringify(v)}`);
  }
}

/** Validate a candidate rule document. Returns it, typed, if — and only if — it is fully valid. */
export function validateRuleSet(candidate: unknown): RuleSetDocument {
  const issues = new IssueCollector();
  checkDocument(candidate, issues);
  if (issues.issues.length > 0) throw new RuleValidationError(issues.issues);
  return candidate as RuleSetDocument;
}

function checkDocument(candidate: unknown, issues: IssueCollector): void {
  if (!isPlainObject(candidate)) {
    issues.add('', 'a rule document must be a JSON object', `expected an object, not ${typeOf(candidate)}`);
    return;
  }
  const doc = candidate as RawDoc;

  if (doc.version !== SCHEMA_VERSION) {
    issues.add('/version', `expected schema version ${SCHEMA_VERSION}`, `got ${JSON.stringify(doc.version)}`);
  }
  checkNonEmptyString(doc.id, '/id', issues);
  checkNonEmptyString(doc.name, '/name', issues);
  if (doc.description !== undefined && typeof doc.description !== 'string') {
    issues.add('/description', 'description must be a string when present');
  }
  if (doc.author !== undefined && typeof doc.author !== 'string') {
    issues.add('/author', 'author must be a string when present');
  }
  if (doc.symmetry !== undefined && doc.symmetry !== 'none' && doc.symmetry !== 'rotational') {
    issues.add('/symmetry', 'symmetry must be "none" or "rotational" when present');
  }

  const stateCount = checkStates(doc.states, issues);

  if (typeof doc.boundary !== 'string' || !BOUNDARY_KINDS.has(doc.boundary)) {
    issues.add('/boundary', 'boundary must be one of bounded, toroidal, infinite', `got ${JSON.stringify(doc.boundary)}`);
  }

  const neighbourCount = checkNeighborhood(doc.neighborhood, issues);

  if (stateCount !== null && neighbourCount !== null) {
    checkTransition(doc.transition, stateCount, neighbourCount, issues);
  } else if (doc.transition === undefined || !isPlainObject(doc.transition)) {
    issues.add('/transition', 'transition must be an object');
  }
}

/** Returns the validated state count, or `null` if `states` itself is too malformed to use. */
function checkStates(v: unknown, issues: IssueCollector): number | null {
  if (!Array.isArray(v) || v.length === 0) {
    issues.add('/states', 'states must be a non-empty array', 'declare at least the dead state (id 0)');
    return null;
  }

  let sawShapeError = false;
  const parsed: Array<{ id: number; kind: string }> = [];
  v.forEach((entry: unknown, i: number) => {
    const path = `/states/${i}`;
    if (!isPlainObject(entry)) {
      issues.add(path, 'each state must be an object');
      sawShapeError = true;
      return;
    }
    const state = entry as RawState;
    if (!isInt(state.id) || state.id < 0) {
      issues.add(`${path}/id`, 'state id must be a non-negative integer', `got ${JSON.stringify(state.id)}`);
      sawShapeError = true;
    }
    checkNonEmptyString(state.name, `${path}/name`, issues);
    if (typeof state.kind !== 'string' || !STATE_KINDS.has(state.kind)) {
      issues.add(`${path}/kind`, 'kind must be one of dead, live, decay, inert', `got ${JSON.stringify(state.kind)}`);
      sawShapeError = true;
    }
    if (typeof state.countsAsAlive !== 'boolean') {
      issues.add(`${path}/countsAsAlive`, 'countsAsAlive must be a boolean');
    }
    if (isInt(state.id) && typeof state.kind === 'string') {
      parsed.push({ id: state.id, kind: state.kind });
    }
  });
  if (sawShapeError) return null;

  const ids = parsed.map((s) => s.id).sort((a, b) => a - b);
  const contiguous = ids.every((id, i) => id === i);
  if (!contiguous) {
    issues.add('/states', 'state ids must be contiguous starting from 0', `got ids [${ids.join(', ')}]`);
  }

  const deadStates = parsed.filter((s) => s.kind === 'dead');
  if (deadStates.length !== 1) {
    issues.add('/states', 'exactly one state must have kind "dead"', `found ${deadStates.length}`);
  } else if (deadStates[0]?.id !== 0) {
    issues.add('/states', 'the dead state must be id 0', `dead state has id ${deadStates[0]?.id}`);
  }

  return contiguous ? ids.length : null;
}

/** Returns the neighbour count, or `null` if the neighbourhood is too malformed to use downstream. */
function checkNeighborhood(candidate: unknown, issues: IssueCollector): number | null {
  if (!isPlainObject(candidate)) {
    issues.add('/neighborhood', 'neighborhood.kind must be one of moore, vonNeumann, hex, custom');
    return null;
  }
  const n = candidate as RawNeighborhood;
  if (typeof n.kind !== 'string' || !NEIGHBORHOOD_KINDS.has(n.kind)) {
    issues.add('/neighborhood', 'neighborhood.kind must be one of moore, vonNeumann, hex, custom');
    return null;
  }

  if (n.kind === 'moore' || n.kind === 'vonNeumann') {
    if (!isInt(n.radius) || n.radius < 1) {
      issues.add('/neighborhood/radius', 'radius must be a positive integer', `got ${JSON.stringify(n.radius)}`);
      return null;
    }
  }
  if (n.kind === 'custom') {
    if (!Array.isArray(n.offsets) || n.offsets.some((o: unknown) => !isIntArray(o) || o.length !== 2)) {
      issues.add('/neighborhood/offsets', 'offsets must be an array of [dx, dy] integer pairs');
      return null;
    }
  }

  try {
    return compileNeighborhood(n as unknown as Neighborhood).count;
  } catch (e) {
    // compileNeighborhood only ever throws RuleValidationError (custom-offset checks); the
    // shape checks above already rule out every other way in. Kept as a guard, not a path a
    // valid test can reach.
    /* v8 ignore start */
    if (!(e instanceof RuleValidationError)) {
      issues.add('/neighborhood', 'failed to compile neighbourhood', String(e));
      return null;
    }
    /* v8 ignore stop */
    for (const issue of e.issues) issues.add(issue.path, issue.message, issue.hint);
    return null;
  }
}

function checkTransition(
  candidate: unknown,
  stateCount: number,
  neighbourCount: number,
  issues: IssueCollector,
): void {
  if (!isPlainObject(candidate)) {
    issues.add(
      '/transition',
      'transition.kind must be one of totalistic, generations, stateTable, weighted, turmite',
    );
    return;
  }
  const t = candidate as RawTransition;
  if (typeof t.kind !== 'string' || !TRANSITION_KINDS.has(t.kind)) {
    issues.add(
      '/transition',
      'transition.kind must be one of totalistic, generations, stateTable, weighted, turmite',
    );
    return;
  }

  switch (t.kind) {
    case 'totalistic':
      checkBornSurvive(t, neighbourCount, issues);
      if (t.decayStates !== undefined && (!isInt(t.decayStates) || t.decayStates < 0)) {
        issues.add('/transition/decayStates', 'decayStates must be a non-negative integer when present');
      }
      return;
    case 'generations':
      checkBornSurvive(t, neighbourCount, issues);
      if (!isInt(t.states) || t.states < 2) {
        issues.add('/transition/states', 'states must be an integer >= 2', `got ${JSON.stringify(t.states)}`);
      }
      return;
    case 'stateTable':
      checkStateTable(t, stateCount, neighbourCount, issues);
      return;
    case 'weighted':
      checkWeighted(t, stateCount, issues);
      return;
    case 'turmite':
      checkTurmite(t, stateCount, issues);
      return;
    /* v8 ignore next 3 -- unreachable: TRANSITION_KINDS.has(t.kind) above already narrowed this. */
    default:
      return;
  }
}

function checkBornSurvive(t: RawTransition, neighbourCount: number, issues: IssueCollector): void {
  for (const field of ['born', 'survive'] as const) {
    const arr = field === 'born' ? t.born : t.survive;
    if (!isIntArray(arr)) {
      issues.add(`/transition/${field}`, `${field} must be an array of integers`);
      continue;
    }
    arr.forEach((n, i) => {
      if (n < 0 || n > neighbourCount) {
        issues.add(
          `/transition/${field}/${i}`,
          `${field} values must be within 0..${neighbourCount} (this neighbourhood's count)`,
          `got ${n}`,
        );
      }
    });
  }
}

function checkStateTable(
  t: RawTransition,
  stateCount: number,
  neighbourCount: number,
  issues: IssueCollector,
): void {
  if (!isInt(t.radix) || t.radix < 2) {
    issues.add('/transition/radix', 'radix must be an integer >= 2', `got ${JSON.stringify(t.radix)}`);
    return;
  }
  if (t.radix !== stateCount) {
    issues.add('/transition/radix', 'radix must equal the number of declared states', `radix ${t.radix}, states ${stateCount}`);
  }
  const table = t.table;
  const length =
    table instanceof Uint8Array ? table.length : Array.isArray(table) ? table.length : null;
  if (length === null) {
    issues.add('/transition/table', 'table must be a Uint8Array (or array) of state values');
    return;
  }
  const expected = stateCount * t.radix ** neighbourCount;
  if (length !== expected) {
    issues.add(
      '/transition/table',
      `table length must equal radix**neighbourCount * states (${expected})`,
      `got length ${length}`,
    );
  }
}

function checkWeighted(t: RawTransition, stateCount: number, issues: IssueCollector): void {
  if (!isIntArray(t.weights) || t.weights.length !== stateCount) {
    issues.add('/transition/weights', `weights must be an array of ${stateCount} integers, one per state`);
  }
  if (!Array.isArray(t.thresholds) || t.thresholds.length === 0) {
    issues.add('/transition/thresholds', 'thresholds must be a non-empty array');
    return;
  }
  t.thresholds.forEach((entry: unknown, i: number) => {
    const path = `/transition/thresholds/${i}`;
    if (!isPlainObject(entry)) {
      issues.add(path, 'each threshold row must be an object');
      return;
    }
    const row = entry as RawThresholdRow;
    if (!isInt(row.min) || !isInt(row.max) || !isInt(row.toState)) {
      issues.add(path, 'each threshold row needs integer min, max, and toState');
      return;
    }
    if (row.min > row.max) {
      issues.add(path, 'min must be <= max', `got min ${row.min}, max ${row.max}`);
    }
    if (row.toState < 0 || row.toState >= stateCount) {
      issues.add(`${path}/toState`, 'toState must reference a declared state id', `got ${row.toState}`);
    }
  });
}

function checkTurmite(t: RawTransition, stateCount: number, issues: IssueCollector): void {
  if (!Array.isArray(t.states) || t.states.length === 0) {
    issues.add('/transition/states', 'a turmite rule needs a non-empty states array');
    return;
  }
  t.states.forEach((entry: unknown, i: number) => {
    const path = `/transition/states/${i}`;
    if (!isPlainObject(entry)) {
      issues.add(path, 'each turmite row must be an object');
      return;
    }
    const row = entry as RawTurmiteRow;
    if (!isInt(row.state) || row.state < 0) issues.add(`${path}/state`, 'state must be a non-negative integer');
    if (!isInt(row.nextState) || row.nextState < 0) {
      issues.add(`${path}/nextState`, 'nextState must be a non-negative integer');
    }
    if (!isInt(row.onCellState) || row.onCellState < 0 || row.onCellState >= stateCount) {
      issues.add(`${path}/onCellState`, 'onCellState must reference a declared state id');
    }
    if (!isInt(row.writeState) || row.writeState < 0 || row.writeState >= stateCount) {
      issues.add(`${path}/writeState`, 'writeState must reference a declared state id');
    }
    if (typeof row.turn !== 'string' || !TURN_KINDS.has(row.turn)) {
      issues.add(`${path}/turn`, 'turn must be one of left, right, uturn, none');
    }
  });
}
