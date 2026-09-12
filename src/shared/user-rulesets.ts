/**
 * User-authored ruleset store (P2-E-4). The same version-walk as
 * {@link migrateSessionDoc}: a v1 blob still loads after a Phase 3/4 wrapper
 * is added, because new hops go in {@link USER_RULESET_MIGRATIONS} and old
 * documents keep their `rulesets` array.
 *
 * This module is the document, not the disk — `localStorage` and
 * `POST /api/rulesets` live in `client/`.
 */
import { upgradeToVersion, type MigrationStep } from './session.js';

export const CURRENT_USER_RULESET_VERSION = 1;
export const USER_RULESET_PREFIX = 'user:';

export interface UserRulesetStoreV1 {
  readonly version: 1;
  readonly rulesets: readonly unknown[];
}

export type UserRulesetStore = UserRulesetStoreV1;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Empty today — v1 is current. Phase 3/4 adds `1: upgradeV1ToV2` here without
 * rewriting this function. Never remove an old hop.
 */
export const USER_RULESET_MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

export function packUserRulesets(rulesets: readonly unknown[]): UserRulesetStoreV1 {
  return { version: 1, rulesets: [...rulesets] };
}

export function isUserRulesetId(id: string): boolean {
  return id.startsWith(USER_RULESET_PREFIX) && id.length > USER_RULESET_PREFIX.length;
}

/** Server-owned `user:` id from a raw document id or name. Unsafe leftovers become `untitled`. */
export function suggestUserRulesetId(rawId: string): string {
  const local = rawId.startsWith(USER_RULESET_PREFIX) ? rawId.slice(USER_RULESET_PREFIX.length) : rawId;
  const slug = local
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
  return slug ? `${USER_RULESET_PREFIX}${slug}` : `${USER_RULESET_PREFIX}untitled`;
}

/**
 * Parses and upgrades a raw store blob into today's ruleset list, or `null`
 * if it's corrupt, from a version with no path, or newer than this build.
 * Never throws — a bad blob is an empty library, not a crash.
 */
export function migrateUserRulesets(
  raw: unknown,
  migrations: Readonly<Record<number, MigrationStep>> = USER_RULESET_MIGRATIONS,
  targetVersion: number = CURRENT_USER_RULESET_VERSION,
): unknown[] | null {
  if (!isJsonRecord(raw)) return null;
  const version = raw['version'];
  if (typeof version !== 'number' || !Number.isFinite(version) || version < 1) return null;
  if (version > targetVersion) return null;
  const upgraded = upgradeToVersion(raw, version, targetVersion, migrations);
  if (!upgraded) return null;
  const list = upgraded['rulesets'];
  return Array.isArray(list) ? list : null;
}
