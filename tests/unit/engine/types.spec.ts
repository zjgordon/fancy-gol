import { describe, expect, expectTypeOf, it } from 'vitest';
import { DEAD } from '@engine/types';
import type { ChangeSet, RuleSet, StateId } from '@engine/types';

describe('RuleSet shape (ADR-001)', () => {
  it('pins the RuleSet contract', () => {
    expectTypeOf<RuleSet>().toHaveProperty('id').toEqualTypeOf<string>();
    expectTypeOf<RuleSet>().toHaveProperty('name').toEqualTypeOf<string>();
    expectTypeOf<RuleSet>().toHaveProperty('states').toEqualTypeOf<RuleSet['states']>();
    expectTypeOf<RuleSet>().toHaveProperty('neighborhood');
    expectTypeOf<RuleSet>().toHaveProperty('transition');
    expectTypeOf<RuleSet>()
      .toHaveProperty('boundary')
      .toEqualTypeOf<'bounded' | 'toroidal' | 'infinite'>();
  });
});

describe('ChangeSet shape (ADR-007)', () => {
  it('pins the ChangeSet contract', () => {
    expectTypeOf<ChangeSet>().toHaveProperty('tick').toEqualTypeOf<number>();
    expectTypeOf<ChangeSet>().toHaveProperty('coords').toEqualTypeOf<Int32Array>();
    expectTypeOf<ChangeSet>().toHaveProperty('from').toEqualTypeOf<Uint8Array>();
    expectTypeOf<ChangeSet>().toHaveProperty('to').toEqualTypeOf<Uint8Array>();
    expectTypeOf<ChangeSet>().toHaveProperty('count').toEqualTypeOf<number>();
    expectTypeOf<ChangeSet>().toHaveProperty('dirtyChunks').toEqualTypeOf<Int32Array>();
  });
});

describe('StateId / DEAD', () => {
  it('StateId is a plain number and DEAD is 0', () => {
    expectTypeOf<StateId>().toEqualTypeOf<number>();
    expectTypeOf(DEAD).toEqualTypeOf<StateId>();
    expect(DEAD).toBe(0);
  });
});
