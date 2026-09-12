/**
 * Persist user rulesets (P2-E-4): `localStorage` is the no-account home;
 * `POST /api/rulesets` is best-effort when the server is up.
 */
import {
  migrateUserRulesets,
  packUserRulesets,
  suggestUserRulesetId,
  type UserRulesetStoreV1,
} from '@shared/user-rulesets';

export const USER_RULESET_STORAGE_KEY = 'fancy-gol:user-rulesets';

export interface UserRulesetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type UserRulesetFetch = (input: string, init?: RequestInit) => Promise<{
  readonly ok: boolean;
  readonly status: number;
  json(): Promise<unknown>;
}>;

export function realUserRulesetStorage(): UserRulesetStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = `${USER_RULESET_STORAGE_KEY}:probe`;
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export function loadUserRulesets(storage: UserRulesetStorage | null): unknown[] {
  if (!storage) return [];
  const raw = storage.getItem(USER_RULESET_STORAGE_KEY);
  if (raw === null) return [];
  try {
    return migrateUserRulesets(JSON.parse(raw) as unknown) ?? [];
  } catch {
    return [];
  }
}

export function writeUserRulesets(storage: UserRulesetStorage, rulesets: readonly unknown[]): void {
  const doc: UserRulesetStoreV1 = packUserRulesets(rulesets);
  storage.setItem(USER_RULESET_STORAGE_KEY, JSON.stringify(doc));
}

export function upsertUserRuleset<T extends { readonly id: string }>(list: readonly T[], next: T): T[] {
  const out: T[] = [];
  let replaced = false;
  for (const item of list) {
    if (item.id === next.id) {
      out.push(next);
      replaced = true;
    } else {
      out.push(item);
    }
  }
  if (!replaced) out.push(next);
  return out;
}

export function mergeUserRulesets(local: readonly unknown[], remote: readonly unknown[]): unknown[] {
  const byId = new Map<string, unknown>();
  for (const item of remote) {
    const id = recordId(item);
    if (id) byId.set(id, item);
  }
  for (const item of local) {
    const id = recordId(item);
    if (id) byId.set(id, item);
  }
  return [...byId.values()];
}

function recordId(item: unknown): string | null {
  if (typeof item !== 'object' || item === null) return null;
  const id = (item as { id?: unknown }).id;
  return typeof id === 'string' && id.length > 0 ? id : null;
}

export async function postUserRuleset(
  document: unknown,
  fetchFn: UserRulesetFetch,
): Promise<string | null> {
  try {
    const res = await fetchFn('/api/rulesets', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(document),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id?: unknown };
    return typeof body.id === 'string' ? body.id : null;
  } catch {
    return null;
  }
}

export async function fetchRemoteUserRulesets(fetchFn: UserRulesetFetch): Promise<unknown[]> {
  try {
    const res = await fetchFn('/api/rulesets');
    if (!res.ok) return [];
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    const ids = body
      .map((item) => recordId(item))
      .filter((id): id is string => id !== null && id.startsWith('user:'));
    const docs = await Promise.all(
      ids.map(async (id) => {
        const one = await fetchFn(`/api/rulesets/${encodeURIComponent(id)}`);
        if (!one.ok) return null;
        return one.json();
      }),
    );
    return docs.filter((doc): doc is NonNullable<typeof doc> => doc != null);
  } catch {
    return [];
  }
}

export function withUserId<T extends { readonly id: string }>(document: T): T {
  const id = suggestUserRulesetId(document.id);
  return id === document.id ? document : { ...document, id };
}
