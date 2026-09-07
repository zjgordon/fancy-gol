/**
 * `SessionDoc` (P1-F-1): the versioned, JSON-serialisable capture of everything a reload needs to
 * put a user back where they left off — `{ version, ruleset, grid, camera, tick, seed, theme,
 * toolState }` per the phase doc, plus `gridOrigin` (the RLE pattern's world-space top-left; RLE
 * text alone only has *local* width/height, and the grid must reappear at the exact world
 * position the camera also gets restored to, not wherever `(0,0)` happens to be).
 *
 * `grid` is RLE text — a deliberate choice, not an oversight: P1-F-2 (shareable URLs) compresses
 * this exact same RLE string for the URL fragment, so the grid needs to already be that format
 * here, not the richer `Snapshot` (ADR-007/P0-E-4) a worker restart uses. This is why session
 * restore is *not* a claim of bit-identical continued simulation for a stochastic rule — only
 * `tick`/`seed` are recorded, not the PRNG's exact internal state, the same "seed alone breaks
 * the instant a rule consumes randomness" tradeoff ADR-007 already names and accepts (that
 * problem is what the History journal exists to solve; a session is a snapshot to resume
 * *editing* from, not a replay oracle).
 *
 * `shared/` may only import `shared/` (ADR-009), so the actual RLE encode/decode — which needs
 * `ui/tools/select.ts`'s codec — lives in `client/session.ts`, which builds and consumes the
 * `SessionDoc` this file only *describes*.
 */
import type { RuleSet } from './types.js';

export const CURRENT_SESSION_VERSION = 1;

/** "id or inline" (the phase doc's own words) as a proper discriminated union rather than a bare
 * `string | RuleSet` — indistinguishable-looking values (a `RuleSet` also has an `id` field)
 * would otherwise need a structural guess instead of a tag. */
export type SessionRuleset =
  | { readonly kind: 'builtin'; readonly id: string }
  | { readonly kind: 'inline'; readonly ruleset: RuleSet };

export interface SessionCamera {
  readonly originX: number;
  readonly originY: number;
  readonly cellSize: number;
}

export interface SessionToolState {
  readonly activeToolId: string;
}

export interface SessionDocV1 {
  readonly version: 1;
  readonly ruleset: SessionRuleset;
  /** RLE text (`ui/tools/select.ts`'s minimal codec, states 0-24) for the live cells within
   * {@link gridOrigin}'s bounding box. Empty grid encodes as a `0×0` pattern. */
  readonly grid: string;
  /** World coordinates of the RLE pattern's local `(0,0)` — see this module's header note. */
  readonly gridOrigin: { readonly x: number; readonly y: number };
  readonly tick: number;
  readonly seed: number;
  readonly camera: SessionCamera;
  readonly theme: string;
  readonly toolState: SessionToolState;
}

/** The current format. A union of every version this build can still *produce* — today, only
 * v1. `migrateSessionDoc` is what can still *read* an older one. */
export type SessionDoc = SessionDocV1;

type JsonRecord = Record<string, unknown>;

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export type MigrationStep = (doc: JsonRecord) => JsonRecord;

/**
 * Upgrades a raw, already-parsed document one version forward, keyed by the version it currently
 * claims to have. Empty today — v1 is both the oldest and the newest version this build knows —
 * but the shape is what lets Phase 2/4 add an entry (`1: upgradeV1ToV2`, `2: upgradeV2ToV3`, …)
 * without touching `migrateSessionDoc` itself or breaking the chain for a document that was
 * frozen at an even older version. Never remove or rewrite an old entry once real documents in
 * the wild might be at that version — see this task's own "a v1 document still loads after the
 * Phase 4 format change" acceptance criterion.
 */
const MIGRATIONS: Readonly<Record<number, MigrationStep>> = {};

/**
 * The chain-walking mechanism itself, factored out from `migrateSessionDoc` and generic over its
 * migration table and target version so it can be exercised directly — with today's real
 * `MIGRATIONS` empty, `migrateSessionDoc` alone can only ever call this with `version ===
 * targetVersion`, never touching the loop body. `tests/unit/shared/session.spec.ts` drives this
 * function with synthetic migrations to prove the *chaining* — not any real version's content,
 * which doesn't exist yet — actually works: multiple hops, and a document stuck at a version with
 * no migration returning `null` rather than a half-upgraded document.
 */
export function upgradeToVersion(
  doc: JsonRecord,
  fromVersion: number,
  targetVersion: number,
  migrations: Readonly<Record<number, MigrationStep>>,
): JsonRecord | null {
  let version = fromVersion;
  let current = doc;
  while (version < targetVersion) {
    const step = migrations[version];
    if (!step) return null;
    current = step(current);
    version += 1;
  }
  return version === targetVersion ? current : null;
}

function isSessionRuleset(value: unknown): value is SessionRuleset {
  if (!isJsonRecord(value)) return false;
  if (value['kind'] === 'builtin') return typeof value['id'] === 'string';
  if (value['kind'] === 'inline') return isJsonRecord(value['ruleset']);
  return false;
}

function isSessionCamera(value: unknown): value is SessionCamera {
  return (
    isJsonRecord(value) &&
    typeof value['originX'] === 'number' &&
    typeof value['originY'] === 'number' &&
    typeof value['cellSize'] === 'number'
  );
}

function isGridOrigin(value: unknown): value is SessionDocV1['gridOrigin'] {
  return isJsonRecord(value) && typeof value['x'] === 'number' && typeof value['y'] === 'number';
}

/** Structural validation for a document already confirmed to be `version: 1` — never trust
 * `localStorage` (a browser extension, a hand-edited value, a future build's document a user
 * downgraded into) to actually match the shape it claims. */
function isValidV1(doc: JsonRecord): doc is JsonRecord & SessionDocV1 {
  return (
    doc['version'] === 1 &&
    isSessionRuleset(doc['ruleset']) &&
    typeof doc['grid'] === 'string' &&
    isGridOrigin(doc['gridOrigin']) &&
    typeof doc['tick'] === 'number' &&
    typeof doc['seed'] === 'number' &&
    isSessionCamera(doc['camera']) &&
    typeof doc['theme'] === 'string' &&
    isJsonRecord(doc['toolState']) &&
    typeof doc['toolState']['activeToolId'] === 'string'
  );
}

/**
 * Parses and upgrades a raw, already-`JSON.parse`d value into today's {@link SessionDoc}, or
 * `null` if it's corrupt, from a version with no migration path, or from a version newer than
 * this build understands. Never throws — a bad document is a fresh start, not a crash.
 */
export function migrateSessionDoc(raw: unknown): SessionDoc | null {
  if (!isJsonRecord(raw)) return null;
  const version = typeof raw['version'] === 'number' ? raw['version'] : NaN;
  if (!Number.isInteger(version) || version < 1) return null;

  const upgraded = upgradeToVersion(raw, version, CURRENT_SESSION_VERSION, MIGRATIONS);
  return upgraded && isValidV1(upgraded) ? upgraded : null;
}
