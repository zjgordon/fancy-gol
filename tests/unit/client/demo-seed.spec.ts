import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { GOSPER_GUN, gunOps, primaryLiveState } from '@client/demo-seed';

describe('gunOps', () => {
  it('paints 36 cells offset into the given live state', () => {
    const ops = gunOps(20, 10, 2);
    expect(ops).toHaveLength(GOSPER_GUN.length);
    expect(ops).toHaveLength(36);
    expect(ops[0]).toEqual({ x: 44, y: 10, state: 2 });
  });
});

describe('primaryLiveState', () => {
  it('picks Conway alive, and falls back to 1 when nothing counts as alive', () => {
    expect(primaryLiveState(CONWAY)).toBe(1);
    expect(
      primaryLiveState({
        ...CONWAY,
        states: CONWAY.states.map((s) => ({ ...s, countsAsAlive: false })),
      }),
    ).toBe(1);
  });
});
