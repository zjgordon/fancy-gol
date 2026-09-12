import { describe, expect, it, vi } from 'vitest';
import {
  USER_RULESET_STORAGE_KEY,
  fetchRemoteUserRulesets,
  loadUserRulesets,
  mergeUserRulesets,
  postUserRuleset,
  upsertUserRuleset,
  withUserId,
  writeUserRulesets,
} from '@client/user-rulesets';
import { packUserRulesets } from '@shared/user-rulesets';

function memory() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
  };
}

const SPARK = { id: 'user:spark', name: 'Spark' };
const OTHER = { id: 'user:other', name: 'Other' };

describe('user ruleset persistence', () => {
  it('round-trips through localStorage and skips a corrupt blob', () => {
    const storage = memory();
    writeUserRulesets(storage, [SPARK]);
    expect(loadUserRulesets(storage)).toEqual([SPARK]);
    expect(JSON.parse(storage.getItem(USER_RULESET_STORAGE_KEY)!)).toEqual(packUserRulesets([SPARK]));
    storage.setItem(USER_RULESET_STORAGE_KEY, '{');
    expect(loadUserRulesets(storage)).toEqual([]);
    expect(loadUserRulesets(null)).toEqual([]);
  });

  it('upserts by id and lets local win a merge', () => {
    expect(upsertUserRuleset([SPARK], { id: 'user:spark', name: 'Renamed' })).toEqual([
      { id: 'user:spark', name: 'Renamed' },
    ]);
    expect(upsertUserRuleset([SPARK], OTHER)).toEqual([SPARK, OTHER]);
    expect(mergeUserRulesets([{ id: 'user:spark', name: 'Local' }], [SPARK, OTHER])).toEqual([
      { id: 'user:spark', name: 'Local' },
      OTHER,
    ]);
    expect(withUserId({ id: 'Spark', name: 'Spark' }).id).toBe('user:spark');
  });

  it('POSTs when the server is up and ignores a down server', async () => {
    const fetchOk = vi.fn(() =>
      Promise.resolve({ ok: true, status: 201, json: () => Promise.resolve({ id: 'user:spark' }) }),
    );
    await expect(postUserRuleset(SPARK, fetchOk)).resolves.toBe('user:spark');
    expect(fetchOk).toHaveBeenCalledWith('/api/rulesets', expect.objectContaining({ method: 'POST' }));
    const fetchDown = vi.fn(() => Promise.reject(new Error('offline')));
    await expect(postUserRuleset(SPARK, fetchDown)).resolves.toBeNull();
  });

  it('loads full user documents from GET /api/rulesets', async () => {
    const fetchFn = vi.fn((url: string) => {
      if (url === '/api/rulesets') {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => Promise.resolve([{ id: 'conway' }, { id: 'user:spark' }]),
        });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(SPARK) });
    });
    await expect(fetchRemoteUserRulesets(fetchFn)).resolves.toEqual([SPARK]);
    expect(fetchFn).toHaveBeenCalledWith('/api/rulesets/user%3Aspark');
    await expect(fetchRemoteUserRulesets(() => Promise.reject(new Error('down')))).resolves.toEqual([]);
    await expect(
      postUserRuleset(SPARK, () => Promise.resolve({ ok: false, status: 400, json: () => Promise.resolve({}) })),
    ).resolves.toBeNull();
    expect(mergeUserRulesets([{ nope: true }], [{ id: 'user:x' }])).toEqual([{ id: 'user:x' }]);
  });
});
