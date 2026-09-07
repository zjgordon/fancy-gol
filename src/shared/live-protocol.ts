/**
 * `/live`'s wire protocol (ADR-002, P1-G-3) — plain JSON, deliberately not `shared/protocol.ts`'s
 * worker protocol: a WebSocket to an arbitrary browser can't transfer a typed array zero-copy the
 * way `postMessage` to a same-origin worker can, and `/live` is a read-only broadcast, never a
 * command channel, so there is no `Command` side to define here at all — only what the server
 * ever sends.
 *
 * `shared/` may only import `shared/` (ADR-009), and both `server/live-hub.ts` and
 * `client/live-client.ts` need the identical message shape — exactly what this layer is for.
 */
import type { RuleSet } from './types.js';

export const LIVE_PROTOCOL_VERSION = 1;

/** One non-dead cell, as a plain tuple — compact JSON with no per-cell object overhead. */
export type LiveCell = readonly [x: number, y: number, state: number];

/** Sent once when a client joins, and again to any client that fell behind (its `bufferedAmount`
 * exceeded the hub's threshold) once it has fully drained — a full resync, not a claim that
 * every intervening delta is recoverable. */
export interface LiveKeyframeMessage {
  readonly type: 'keyframe';
  readonly version: number;
  readonly tick: number;
  readonly ruleset: RuleSet;
  readonly bounds: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly cells: readonly LiveCell[];
}

/** Sent every broadcast tick to every client that is keeping up. */
export interface LiveDeltaMessage {
  readonly type: 'delta';
  readonly tick: number;
  readonly changes: readonly LiveCell[];
}

export type LiveMessage = LiveKeyframeMessage | LiveDeltaMessage;

function isLiveCell(value: unknown): value is LiveCell {
  return Array.isArray(value) && value.length === 3 && value.every((n) => typeof n === 'number');
}

function isBounds(value: unknown): value is LiveKeyframeMessage['bounds'] {
  if (typeof value !== 'object' || value === null) return false;
  const b = value as Record<string, unknown>;
  return typeof b['x'] === 'number' && typeof b['y'] === 'number' && typeof b['width'] === 'number' && typeof b['height'] === 'number';
}

/**
 * Parses an already-`JSON.parse`d value into a {@link LiveMessage}, or `null` if it isn't one —
 * a malformed frame (a future incompatible version, a proxy mangling bytes) is "ignore this
 * message", never a thrown exception, the same guard `shared/protocol.ts`'s `parseCommand`/
 * `parseEvent` already model for the worker channel.
 */
export function parseLiveMessage(raw: unknown): LiveMessage | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const obj = raw as Record<string, unknown>;

  if (obj['type'] === 'delta') {
    if (typeof obj['tick'] !== 'number') return null;
    if (!Array.isArray(obj['changes']) || !obj['changes'].every(isLiveCell)) return null;
    return { type: 'delta', tick: obj['tick'], changes: obj['changes'] };
  }

  if (obj['type'] === 'keyframe') {
    if (typeof obj['version'] !== 'number') return null;
    if (typeof obj['tick'] !== 'number') return null;
    if (typeof obj['ruleset'] !== 'object' || obj['ruleset'] === null) return null;
    if (!isBounds(obj['bounds'])) return null;
    if (!Array.isArray(obj['cells']) || !obj['cells'].every(isLiveCell)) return null;
    return {
      type: 'keyframe',
      version: obj['version'],
      tick: obj['tick'],
      ruleset: obj['ruleset'] as RuleSet,
      bounds: obj['bounds'],
      cells: obj['cells'],
    };
  }

  return null;
}
