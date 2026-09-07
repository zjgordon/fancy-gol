import { describe, expect, it } from 'vitest';
import { LIVE_PROTOCOL_VERSION, parseLiveMessage, type LiveKeyframeMessage } from '@shared/live-protocol';

const RULESET = {
  id: 'conway',
  name: "Conway's Game of Life",
  states: [],
  neighborhood: { kind: 'moore', radius: 1 },
  transition: { kind: 'totalistic', born: [3], survive: [2, 3] },
  boundary: 'toroidal',
};

function validKeyframe(): LiveKeyframeMessage {
  return {
    type: 'keyframe',
    version: LIVE_PROTOCOL_VERSION,
    tick: 42,
    ruleset: RULESET as never,
    bounds: { x: 0, y: 0, width: 4, height: 4 },
    cells: [
      [0, 0, 1],
      [1, 1, 1],
    ],
  };
}

describe('parseLiveMessage — delta', () => {
  it('accepts a well-formed delta message', () => {
    const msg = { type: 'delta', tick: 7, changes: [[1, 2, 1]] };
    expect(parseLiveMessage(msg)).toEqual(msg);
  });

  it('accepts an empty changes array', () => {
    expect(parseLiveMessage({ type: 'delta', tick: 7, changes: [] })).toEqual({
      type: 'delta',
      tick: 7,
      changes: [],
    });
  });

  it('rejects a missing or non-numeric tick', () => {
    expect(parseLiveMessage({ type: 'delta', changes: [] })).toBeNull();
    expect(parseLiveMessage({ type: 'delta', tick: '7', changes: [] })).toBeNull();
  });

  it('rejects a non-array or malformed-tuple changes field', () => {
    expect(parseLiveMessage({ type: 'delta', tick: 1, changes: 'nope' })).toBeNull();
    expect(parseLiveMessage({ type: 'delta', tick: 1, changes: [[1, 2]] })).toBeNull(); // missing state
    expect(parseLiveMessage({ type: 'delta', tick: 1, changes: [[1, 2, 'x']] })).toBeNull(); // non-numeric state
  });
});

describe('parseLiveMessage — keyframe', () => {
  it('accepts a well-formed keyframe message', () => {
    const msg = validKeyframe();
    expect(parseLiveMessage(msg)).toEqual(msg);
  });

  it('rejects a missing version, tick, ruleset, bounds, or cells field', () => {
    const base = validKeyframe();
    for (const field of ['version', 'tick', 'ruleset', 'bounds', 'cells'] as const) {
      const withoutField: Record<string, unknown> = { ...base };
      delete withoutField[field];
      expect(parseLiveMessage(withoutField), `missing ${field}`).toBeNull();
    }
  });

  it('rejects malformed bounds (missing a dimension)', () => {
    expect(parseLiveMessage({ ...validKeyframe(), bounds: { x: 0, y: 0, width: 4 } })).toBeNull();
  });

  it('rejects a non-object ruleset', () => {
    expect(parseLiveMessage({ ...validKeyframe(), ruleset: 'conway' })).toBeNull();
  });
});

describe('parseLiveMessage — general', () => {
  it('rejects null, non-objects, and an unknown type', () => {
    expect(parseLiveMessage(null)).toBeNull();
    expect(parseLiveMessage('hello')).toBeNull();
    expect(parseLiveMessage(42)).toBeNull();
    expect(parseLiveMessage({ type: 'something-else' })).toBeNull();
  });

  it('never throws on deeply malformed input', () => {
    expect(() => parseLiveMessage({ type: 'keyframe', cells: [null, undefined, {}] })).not.toThrow();
    expect(() => parseLiveMessage([1, 2, 3])).not.toThrow();
  });
});
