import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CURRENT_USER_RULESET_VERSION,
  migrateUserRulesets,
  packUserRulesets,
  suggestUserRulesetId,
  isUserRulesetId,
} from '@shared/user-rulesets';
import { upgradeToVersion } from '@shared/session';

const FROZEN_V1 = JSON.parse(
  readFileSync(join(process.cwd(), 'tests/fixtures/rules/user-store/v1.json'), 'utf8'),
) as unknown;

describe('user ruleset store', () => {
  it('still loads a frozen v1 blob', () => {
    const list = migrateUserRulesets(FROZEN_V1);
    expect(list).toHaveLength(1);
    expect((list?.[0] as { id: string }).id).toBe('user:spark');
    expect(CURRENT_USER_RULESET_VERSION).toBe(1);
  });

  it('keeps user rulesets across a fictional Phase 3/4 v2 wrapper', () => {
    const upgraded = upgradeToVersion(FROZEN_V1 as Record<string, unknown>, 1, 2, {
      1: (doc) => ({ version: 2, rulesets: doc['rulesets'], wrapped: true }),
    });
    expect(upgraded).not.toBeNull();
    expect(upgraded?.['rulesets']).toEqual((FROZEN_V1 as { rulesets: unknown[] }).rulesets);
    expect(upgraded?.['wrapped']).toBe(true);
  });

  it('rejects corrupt or future blobs', () => {
    expect(migrateUserRulesets(null)).toBeNull();
    expect(migrateUserRulesets({ version: 0, rulesets: [] })).toBeNull();
    expect(migrateUserRulesets({ version: 99, rulesets: [] })).toBeNull();
    expect(migrateUserRulesets({ version: 1, rulesets: 'nope' })).toBeNull();
  });

  it('packs today and slugs a safe user id', () => {
    expect(packUserRulesets([{ id: 'user:spark' }])).toEqual({
      version: 1,
      rulesets: [{ id: 'user:spark' }],
    });
    expect(suggestUserRulesetId('Spark Rule')).toBe('user:spark-rule');
    expect(suggestUserRulesetId('user:Already')).toBe('user:already');
    expect(suggestUserRulesetId('***')).toBe('user:untitled');
    expect(isUserRulesetId('user:spark')).toBe(true);
    expect(isUserRulesetId('conway')).toBe(false);
    expect(isUserRulesetId('user:')).toBe(false);
  });
});
