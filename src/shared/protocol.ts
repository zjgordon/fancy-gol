/**
 * The main-thread ↔ worker wire protocol (ADR-006). `Command`s cross main → worker, `Event`s
 * cross worker → main; both are structured-clone-safe (no functions, no class instances).
 *
 * `parseCommand`/`parseEvent` are the boundary guards: given `unknown` (whatever fell out of
 * a `postMessage` handler), they narrow to a typed message or a structured issue — never a
 * thrown exception, so a malformed message can never kill the handler (P0-G-2's job; this
 * module only decides "is this shaped like a message we understand").
 *
 * Deliberately shallow: a guard here checks a `ruleset` field is *an object*, not that it is a
 * *valid* `RuleSet` — full semantic validation is `rules/validate.ts`, an `engine/`-layer
 * module `shared/` may not import from (ADR-009). The worker handler (`worker/`, which may
 * import both) runs that deeper check once a `Command` has already been structurally accepted.
 */
import type { PaintOp, Rect, RuleSet, StatSample, TickStats } from './types';

export const PROTOCOL_VERSION = 1;

/** What the worker reports at `init` — which fast paths and browser features it can use. */
export interface WorkerCaps {
  readonly sharedArrayBuffer: boolean;
  readonly offscreenCanvas: boolean;
}

/** The renderer's visible world region, so `setViewport` lets the worker skip serialising off-screen chunks. */
export interface Viewport {
  readonly rect: Rect;
  /** World units per device pixel; lets the worker skip chunks that would draw under one pixel across. */
  readonly scale: number;
}

/**
 * One `frame` event's grid payload: every touched chunk's packed key and its 1024-byte page,
 * concatenated in `keys` order (the same shape as `Snapshot`, scoped to the current viewport
 * instead of the whole world). Every array here is transferred, never copied.
 */
export interface TransferredChunks {
  readonly keys: Int32Array;
  readonly data: Uint8Array;
}

// main → worker
export type Command =
  | {
      readonly id: number;
      readonly cmd: 'init';
      readonly ruleset: RuleSet;
      readonly width: number;
      readonly height: number;
      readonly seed: number;
    }
  | { readonly id: number; readonly cmd: 'setRuleset'; readonly ruleset: RuleSet }
  | { readonly id: number; readonly cmd: 'step'; readonly n: number }
  | { readonly id: number; readonly cmd: 'run'; readonly tps: number } // free-run at target ticks/sec
  | { readonly id: number; readonly cmd: 'pause' }
  | { readonly id: number; readonly cmd: 'paint'; readonly ops: readonly PaintOp[] }
  | { readonly id: number; readonly cmd: 'clear' }
  | {
      readonly id: number;
      readonly cmd: 'seedRandom';
      readonly density: number;
      readonly seed: number;
    }
  | {
      readonly id: number;
      readonly cmd: 'loadPattern';
      readonly rle: string;
      readonly x: number;
      readonly y: number;
    }
  | { readonly id: number; readonly cmd: 'seek'; readonly tick: number } // time travel (Phase 4)
  | { readonly id: number; readonly cmd: 'snapshot' }
  | { readonly id: number; readonly cmd: 'setViewport'; readonly viewport: Viewport } // worker sends only visible chunks
  | { readonly id: number; readonly cmd: 'dispose' };

// worker → main
export type Event =
  | { readonly id: number; readonly type: 'ready'; readonly capabilities: WorkerCaps }
  | {
      readonly type: 'frame';
      readonly tick: number;
      readonly chunks: TransferredChunks;
      readonly dirty: readonly Rect[];
      readonly stats: TickStats;
    }
  | { readonly type: 'stats'; readonly series: StatSample }
  | { readonly id: number; readonly type: 'ok'; readonly result?: unknown }
  | {
      readonly id: number;
      readonly type: 'error';
      readonly message: string;
      readonly code: string;
    };

/** A rejected `parseCommand`/`parseEvent`: where the message went wrong, never a thrown exception. */
export interface ProtocolIssue {
  readonly path: string;
  readonly message: string;
}

export type ParseResult<T> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly issue: ProtocolIssue };

function ok<T>(value: T): ParseResult<T> {
  return { ok: true, value };
}

function fail<T>(path: string, message: string): ParseResult<T> {
  return { ok: false, issue: { path, message } };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.length > 0;
}

/** Shallow: an object with at least a `states` array. Real validation is `rules/validate.ts` (engine/). */
function isRuleSetShaped(v: unknown): v is RuleSet {
  return (
    isRecord(v) &&
    isNonEmptyString(v['id']) &&
    isNonEmptyString(v['name']) &&
    Array.isArray(v['states'])
  );
}

function isPaintOpShaped(v: unknown): v is PaintOp {
  return (
    isRecord(v) && isFiniteNumber(v['x']) && isFiniteNumber(v['y']) && isFiniteNumber(v['state'])
  );
}

function isViewportShaped(v: unknown): v is Viewport {
  if (!isRecord(v) || !isFiniteNumber(v['scale'])) return false;
  const rect = v['rect'];
  return (
    isRecord(rect) &&
    isFiniteNumber(rect['x']) &&
    isFiniteNumber(rect['y']) &&
    isFiniteNumber(rect['width']) &&
    isFiniteNumber(rect['height'])
  );
}

const COMMAND_KINDS = [
  'init',
  'setRuleset',
  'step',
  'run',
  'pause',
  'paint',
  'clear',
  'seedRandom',
  'loadPattern',
  'seek',
  'snapshot',
  'setViewport',
  'dispose',
] as const;

type CommandKind = (typeof COMMAND_KINDS)[number];

function isCommandKind(v: unknown): v is CommandKind {
  return typeof v === 'string' && (COMMAND_KINDS as readonly string[]).includes(v);
}

/* v8 ignore next 3 -- Command['cmd'] is a closed union; the never-check is for exhaustiveness (structurally unreachable once isCommandKind has already filtered). */
function assertNever(x: never): never {
  throw new Error(`unreachable protocol command kind: ${JSON.stringify(x)}`);
}

/**
 * Narrow `unknown` (whatever a `postMessage` handler received) to a `Command`, or a structured
 * `ProtocolIssue` naming the field that's wrong. Never throws.
 */
export function parseCommand(raw: unknown): ParseResult<Command> {
  if (!isRecord(raw)) return fail('', 'command must be an object');
  if (!isFiniteNumber(raw['id'])) return fail('id', 'command.id must be a finite number');
  const id = raw['id'];
  const cmd = raw['cmd'];
  if (!isCommandKind(cmd)) {
    return fail('cmd', `unknown command "${String(cmd)}"`);
  }

  // Exhaustive over the known-valid kind: adding a Command variant without a case here is a
  // compile error (assertNever), not a silent pass-through.
  switch (cmd) {
    case 'init': {
      if (!isRuleSetShaped(raw['ruleset']))
        return fail('ruleset', 'init.ruleset must be a RuleSet-shaped object');
      if (!isFiniteNumber(raw['width'])) return fail('width', 'init.width must be a finite number');
      if (!isFiniteNumber(raw['height']))
        return fail('height', 'init.height must be a finite number');
      if (!isFiniteNumber(raw['seed'])) return fail('seed', 'init.seed must be a finite number');
      return ok({
        id,
        cmd,
        ruleset: raw['ruleset'],
        width: raw['width'],
        height: raw['height'],
        seed: raw['seed'],
      });
    }
    case 'setRuleset': {
      if (!isRuleSetShaped(raw['ruleset']))
        return fail('ruleset', 'setRuleset.ruleset must be a RuleSet-shaped object');
      return ok({ id, cmd, ruleset: raw['ruleset'] });
    }
    case 'step': {
      if (!isFiniteNumber(raw['n'])) return fail('n', 'step.n must be a finite number');
      return ok({ id, cmd, n: raw['n'] });
    }
    case 'run': {
      if (!isFiniteNumber(raw['tps'])) return fail('tps', 'run.tps must be a finite number');
      return ok({ id, cmd, tps: raw['tps'] });
    }
    case 'pause':
      return ok({ id, cmd });
    case 'paint': {
      const ops = raw['ops'];
      if (!Array.isArray(ops) || !ops.every(isPaintOpShaped)) {
        return fail('ops', 'paint.ops must be an array of {x, y, state}');
      }
      return ok({ id, cmd, ops });
    }
    case 'clear':
      return ok({ id, cmd });
    case 'seedRandom': {
      if (!isFiniteNumber(raw['density']))
        return fail('density', 'seedRandom.density must be a finite number');
      if (!isFiniteNumber(raw['seed']))
        return fail('seed', 'seedRandom.seed must be a finite number');
      return ok({ id, cmd, density: raw['density'], seed: raw['seed'] });
    }
    case 'loadPattern': {
      if (!isNonEmptyString(raw['rle']))
        return fail('rle', 'loadPattern.rle must be a non-empty string');
      if (!isFiniteNumber(raw['x'])) return fail('x', 'loadPattern.x must be a finite number');
      if (!isFiniteNumber(raw['y'])) return fail('y', 'loadPattern.y must be a finite number');
      return ok({ id, cmd, rle: raw['rle'], x: raw['x'], y: raw['y'] });
    }
    case 'seek': {
      if (!isFiniteNumber(raw['tick'])) return fail('tick', 'seek.tick must be a finite number');
      return ok({ id, cmd, tick: raw['tick'] });
    }
    case 'snapshot':
      return ok({ id, cmd });
    case 'setViewport': {
      if (!isViewportShaped(raw['viewport'])) {
        return fail('viewport', 'setViewport.viewport must be a {rect: Rect, scale: number}');
      }
      return ok({ id, cmd, viewport: raw['viewport'] });
    }
    case 'dispose':
      return ok({ id, cmd });
    /* v8 ignore next 2 -- see assertNever above. */
    default:
      return assertNever(cmd);
  }
}

const EVENT_KINDS = ['ready', 'frame', 'stats', 'ok', 'error'] as const;
type EventKind = (typeof EVENT_KINDS)[number];

function isEventKind(v: unknown): v is EventKind {
  return typeof v === 'string' && (EVENT_KINDS as readonly string[]).includes(v);
}

/* v8 ignore next 3 -- Event['type'] is a closed union; the never-check is for exhaustiveness (structurally unreachable once isEventKind has already filtered). */
function assertNeverEvent(x: never): never {
  throw new Error(`unreachable protocol event kind: ${JSON.stringify(x)}`);
}

/**
 * Narrow `unknown` to an `Event`, or a structured `ProtocolIssue`. Shallow in the same sense
 * as {@link parseCommand}: `chunks`/`stats`/`series` are checked for the right shape of
 * container, not deeply validated cell-by-cell.
 */
export function parseEvent(raw: unknown): ParseResult<Event> {
  if (!isRecord(raw)) return fail('', 'event must be an object');
  const type = raw['type'];
  if (!isEventKind(type)) return fail('type', `unknown event "${String(type)}"`);

  switch (type) {
    case 'ready': {
      if (!isFiniteNumber(raw['id'])) return fail('id', 'ready.id must be a finite number');
      const caps = raw['capabilities'];
      if (
        !isRecord(caps) ||
        typeof caps['sharedArrayBuffer'] !== 'boolean' ||
        typeof caps['offscreenCanvas'] !== 'boolean'
      ) {
        return fail('capabilities', 'ready.capabilities must be a WorkerCaps object');
      }
      return ok({ id: raw['id'], type, capabilities: caps as unknown as WorkerCaps });
    }
    case 'frame': {
      if (!isFiniteNumber(raw['tick'])) return fail('tick', 'frame.tick must be a finite number');
      const chunks = raw['chunks'];
      if (
        !isRecord(chunks) ||
        !(chunks['keys'] instanceof Int32Array) ||
        !(chunks['data'] instanceof Uint8Array)
      ) {
        return fail('chunks', 'frame.chunks must be a TransferredChunks object');
      }
      if (!Array.isArray(raw['dirty']))
        return fail('dirty', 'frame.dirty must be an array of Rect');
      if (!isRecord(raw['stats'])) return fail('stats', 'frame.stats must be a TickStats object');
      return ok({
        type,
        tick: raw['tick'],
        chunks: chunks as unknown as TransferredChunks,
        dirty: raw['dirty'] as readonly Rect[],
        stats: raw['stats'] as unknown as TickStats,
      });
    }
    case 'stats': {
      if (!isRecord(raw['series']))
        return fail('series', 'stats.series must be a StatSample object');
      return ok({ type, series: raw['series'] as unknown as StatSample });
    }
    case 'ok': {
      if (!isFiniteNumber(raw['id'])) return fail('id', 'ok.id must be a finite number');
      return ok({ id: raw['id'], type, ...('result' in raw ? { result: raw['result'] } : {}) });
    }
    case 'error': {
      if (!isFiniteNumber(raw['id'])) return fail('id', 'error.id must be a finite number');
      if (!isNonEmptyString(raw['message']))
        return fail('message', 'error.message must be a non-empty string');
      if (!isNonEmptyString(raw['code']))
        return fail('code', 'error.code must be a non-empty string');
      return ok({ id: raw['id'], type, message: raw['message'], code: raw['code'] });
    }
    /* v8 ignore next 2 -- see assertNeverEvent above. */
    default:
      return assertNeverEvent(type);
  }
}
