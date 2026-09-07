/**
 * Session persistence (P1-F-1): turning live app state into a `SessionDoc` and back
 * (`buildSessionDoc`/`applySessionDoc`), and autosaving that document to `localStorage`,
 * debounced at 2s and flushed immediately on `visibilitychange` (`createAutosave`).
 *
 * Shareable URLs (P1-F-2, §2.6's own file-tree comment: "session.ts — autosave, URL hash
 * encode/decode", both jobs in one file): `buildShareLink` deflates a `SessionDoc` (platform
 * `CompressionStream`, zero dependency) into a base64url URL fragment, falling back to
 * `POST /api/sessions` for a short server-backed link once the fragment would exceed ~8kB.
 * `resolveShareFragment` is the inverse, on the reading side — and the one place "never
 * overwrite an existing autosave without asking" (this task's third acceptance criterion) is
 * enforced, via an injected `confirmOverwrite` callback rather than a direct dialog import, the
 * same DI discipline as everything else in this file. Everything after the `#` — never the query
 * string, which a server logs on every request that carries it (this task's own explicit rule).
 *
 * Every impure dependency — where the document is written, how a debounce timer is scheduled,
 * how visibility changes are heard about, how the user is notified of a degraded save or asked
 * before an overwrite, and how a server-backed share is actually posted/fetched — is injected,
 * the same discipline `themes/registry.ts`'s `TokenTarget`/`ThemeStorage`/`PrefersDarkQuery` and
 * `ui/components/shell.ts`'s `Timers` already established. Nothing in this file wires a live
 * `Simulation`/`Camera`/`ThemeRegistry` into `buildSessionDoc`'s `SessionSnapshot` input for
 * production use, calls `createAutosave` from a real boot sequence, or hands `buildShareLink`/
 * `resolveShareFragment` a real `fetch`/`confirmDialog` — that composition is a mechanical
 * follow-up for whichever task builds `client/main.ts`'s full app wiring, the same "this task
 * builds the seam, a later one plugs into it" split `themes/registry.ts`'s own header note
 * already applies to itself.
 */
import { getBuiltin } from '@engine/rules/builtin';
import { DEAD, type GridView, type PaintOp, type RuleSet } from '@shared/types';
import {
  CURRENT_SESSION_VERSION,
  migrateSessionDoc,
  type SessionCamera,
  type SessionDoc,
  type SessionRuleset,
} from '@shared/session';
import { decodeRLE, encodeRLE, type ClipboardCell, type ClipboardPattern } from '@ui/tools/select';

const SESSION_STORAGE_KEY = 'gol.session';
const DEFAULT_DEBOUNCE_MS = 2000;

// -------------------------------------------------------------------------------------------
// Grid <-> RLE
// -------------------------------------------------------------------------------------------

export interface GridCapture {
  readonly rle: string;
  /** World coordinates of the RLE pattern's local `(0,0)` — see `shared/session.ts`'s header. */
  readonly origin: { readonly x: number; readonly y: number };
}

/** Captures every live cell within `grid.bounds()` as RLE text plus that bounding box's
 * world-space origin. A fresh double loop, not `ui/tools/select.ts`'s own module-private
 * `captureCells` — the same deliberate per-module duplication this codebase already applies to
 * `Clock`/`Timers`/etc. (see e.g. `ui/components/shell.ts`'s own note), reusing only that
 * module's *exported* codec (`encodeRLE`/`decodeRLE`), not its internals. */
export function captureGridRLE(grid: GridView): GridCapture {
  const bounds = grid.bounds();
  const cells: ClipboardCell[] = [];
  for (let dy = 0; dy < bounds.height; dy++) {
    for (let dx = 0; dx < bounds.width; dx++) {
      const state = grid.get(bounds.x + dx, bounds.y + dy);
      if (state !== DEAD) cells.push({ x: dx, y: dy, state });
    }
  }
  const pattern: ClipboardPattern = { width: bounds.width, height: bounds.height, cells };
  return { rle: encodeRLE(pattern), origin: { x: bounds.x, y: bounds.y } };
}

/** The inverse of {@link captureGridRLE}: world-space `PaintOp`s for every live cell the RLE
 * encodes. Restoring only ever targets a freshly-constructed `Simulation` (already all-dead), so
 * — unlike `ui/tools/select.ts`'s paste, which must overwrite an existing selection's full
 * footprint including dead cells — this needs no dense fill, only the live cells themselves. */
export function gridPaintOps(doc: Pick<SessionDoc, 'grid' | 'gridOrigin'>): PaintOp[] {
  const pattern = decodeRLE(doc.grid);
  return pattern.cells.map((c) => ({ x: doc.gridOrigin.x + c.x, y: doc.gridOrigin.y + c.y, state: c.state }));
}

// -------------------------------------------------------------------------------------------
// SessionDoc <-> live state
// -------------------------------------------------------------------------------------------

export interface SessionSnapshot {
  readonly ruleset: SessionRuleset;
  readonly grid: GridView;
  readonly tick: number;
  readonly seed: number;
  readonly camera: SessionCamera;
  readonly theme: string;
  readonly activeToolId: string;
}

export function buildSessionDoc(snapshot: SessionSnapshot): SessionDoc {
  const { rle, origin } = captureGridRLE(snapshot.grid);
  return {
    version: CURRENT_SESSION_VERSION,
    ruleset: snapshot.ruleset,
    grid: rle,
    gridOrigin: origin,
    tick: snapshot.tick,
    seed: snapshot.seed,
    camera: snapshot.camera,
    theme: snapshot.theme,
    toolState: { activeToolId: snapshot.activeToolId },
  };
}

export interface RestoredSession {
  readonly ruleset: RuleSet;
  readonly paintOps: readonly PaintOp[];
  readonly tick: number;
  readonly seed: number;
  readonly camera: SessionCamera;
  readonly theme: string;
  readonly activeToolId: string;
}

function resolveRuleset(ref: SessionRuleset): RuleSet {
  if (ref.kind === 'inline') return ref.ruleset;
  const builtin = getBuiltin(ref.id);
  if (!builtin) throw new RangeError(`session referenced unknown builtin ruleset "${ref.id}"`);
  return builtin;
}

/** The inverse of {@link buildSessionDoc}. Throws (a legible `RangeError`, never a silent
 * fallback) if the document names a builtin ruleset this build no longer ships — a caller
 * restoring at boot is expected to catch that and start a fresh session rather than propagate it
 * to a blank screen. */
export function applySessionDoc(doc: SessionDoc): RestoredSession {
  return {
    ruleset: resolveRuleset(doc.ruleset),
    paintOps: gridPaintOps(doc),
    tick: doc.tick,
    seed: doc.seed,
    camera: doc.camera,
    theme: doc.theme,
    activeToolId: doc.toolState.activeToolId,
  };
}

// -------------------------------------------------------------------------------------------
// Injectable environment
// -------------------------------------------------------------------------------------------

/** The same shape `ui/components/shell.ts`'s `Timers` already uses — each module keeps its own
 * copy rather than sharing one (that file's own doc explains why). */
export interface Timers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_TIMERS: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/** The same minimal shape `themes/registry.ts`'s `ThemeStorage` already uses. */
export interface SessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage`, or `null` if it's unavailable or throws — same probe
 * `themes/registry.ts`'s `realThemeStorage()` uses. */
export function realSessionStorage(): SessionStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__gol_session_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

export type VisibilityQuery = () => boolean;

export const SYSTEM_HIDDEN: VisibilityQuery = () =>
  typeof document !== 'undefined' && document.visibilityState === 'hidden';

export interface VisibilitySource {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
}

const NOOP_VISIBILITY_SOURCE: VisibilitySource = {
  addEventListener: () => {},
  removeEventListener: () => {},
};

function realVisibilitySource(): VisibilitySource {
  return typeof document !== 'undefined' ? document : NOOP_VISIBILITY_SOURCE;
}

function isQuotaExceededError(err: unknown): boolean {
  return (
    typeof DOMException !== 'undefined' &&
    err instanceof DOMException &&
    (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22 || err.code === 1014)
  );
}

/**
 * Writes `doc`, degrading gracefully on quota-exceeded rather than crashing (this task's third
 * acceptance criterion): a full document that doesn't fit is retried with the grid dropped
 * (settings kept), and the user is told via `notify`. If even the reduced document doesn't fit,
 * the write is silently skipped for this cycle — the user's edits stay live in memory either
 * way, only the *autosave* is what's missed. Any other write failure (storage disappeared
 * mid-write, a `JSON.stringify` surprise) is likewise swallowed — this runs from inside a
 * debounce timer with no caller to catch an escaping exception, so "never a crash" means never
 * letting one out of this function, not just handling the one case named in the criterion.
 */
export function writeSessionDoc(storage: SessionStorage, doc: SessionDoc, notify: (message: string) => void): void {
  try {
    storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(doc));
  } catch (err) {
    if (!isQuotaExceededError(err)) return;
    const reduced: SessionDoc = { ...doc, grid: '', gridOrigin: { x: 0, y: 0 } };
    try {
      storage.setItem(SESSION_STORAGE_KEY, JSON.stringify(reduced));
      notify("Your pattern was too large to save automatically — your settings were kept, but reloading won't restore the grid.");
    } catch {
      // The reduced document didn't fit either; give up for this cycle rather than loop.
    }
  }
}

/** Reads and migrates the persisted session, or `null` if there isn't one, storage is
 * unavailable, or the stored value is corrupt (bad JSON, or `migrateSessionDoc` rejects it) —
 * every one of those is "start fresh", never a thrown error at boot. */
export function loadSession(storage: SessionStorage | null = realSessionStorage()): SessionDoc | null {
  if (!storage) return null;
  const raw = storage.getItem(SESSION_STORAGE_KEY);
  if (raw === null) return null;
  try {
    return migrateSessionDoc(JSON.parse(raw));
  } catch {
    return null;
  }
}

// -------------------------------------------------------------------------------------------
// Autosave
// -------------------------------------------------------------------------------------------

export interface AutosaveOptions {
  /** Called only when it's actually time to save — building a `SessionDoc` walks the whole live
   * grid, so this is pull-based rather than kept fresh on every edit. */
  readonly buildDoc: () => SessionDoc;
  /** `null` disables autosaving outright (distinct from omitting the option, which falls back to
   * `realSessionStorage()`'s own availability probe). */
  readonly storage?: SessionStorage | null;
  readonly timers?: Timers;
  readonly visibility?: VisibilitySource;
  readonly isHidden?: VisibilityQuery;
  readonly notify?: (message: string) => void;
  readonly debounceMs?: number;
}

export interface Autosave {
  /** Call after any edit. Resets the pending debounce timer rather than stacking one per call. */
  scheduleSave(): void;
  /** Writes immediately, bypassing the debounce — what `visibilitychange` and `dispose()` use. */
  saveNow(): void;
  dispose(): void;
}

/** Debounced at `debounceMs` (default 2000, per the task's own figure) and flushed immediately
 * on `visibilitychange` going hidden — a tab backgrounded or closed mid-debounce still saves,
 * rather than losing up to 2s of edits. */
export function createAutosave(options: AutosaveOptions): Autosave {
  const storage = options.storage === undefined ? realSessionStorage() : options.storage;
  const timers = options.timers ?? REAL_TIMERS;
  const visibility = options.visibility ?? realVisibilitySource();
  const isHidden = options.isHidden ?? SYSTEM_HIDDEN;
  const notify = options.notify ?? (() => {});
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let pending: number | null = null;

  function clearPending(): void {
    if (pending !== null) {
      timers.clearTimeout(pending);
      pending = null;
    }
  }

  function saveNow(): void {
    clearPending();
    if (!storage) return;
    writeSessionDoc(storage, options.buildDoc(), notify);
  }

  function scheduleSave(): void {
    if (!storage) return;
    clearPending();
    pending = timers.setTimeout(saveNow, debounceMs);
  }

  function onVisibilityChange(): void {
    if (isHidden()) saveNow();
  }
  visibility.addEventListener('visibilitychange', onVisibilityChange);

  function dispose(): void {
    clearPending();
    visibility.removeEventListener('visibilitychange', onVisibilityChange);
  }

  return { scheduleSave, saveNow, dispose };
}

// -------------------------------------------------------------------------------------------
// Shareable URLs (P1-F-2)
// -------------------------------------------------------------------------------------------

/** Above this size (in fragment characters — base64url is one byte per character, so this is
 * also bytes), the fragment falls back to a server-backed short link instead. "~8kB" is this
 * task's own figure. */
export const DEFAULT_MAX_FRAGMENT_BYTES = 8192;

const INLINE_PREFIX = 'd:';
const SERVER_PREFIX = 's:';

function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

async function pipeThroughStream(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  // A plain `new Uint8Array(bytes)` copy, not `bytes` itself: `TextEncoder.encode()`'s return
  // type is backed by `ArrayBufferLike` (which admits a `SharedArrayBuffer`), while the stream's
  // `write()` wants the narrower `ArrayBuffer`-backed `Uint8Array` — a real typing distinction,
  // not a formality, so this copy is what actually satisfies it rather than an `as` cast past it.
  const writeDone = writer.write(new Uint8Array(bytes)).then(() => writer.close());
  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) chunks.push(value);
  }
  await writeDone;
  return concatChunks(chunks);
}

/** `deflate-raw`: the leanest of the three `CompressionStream` formats (no zlib/gzip header or
 * checksum trailer) — every byte matters when the whole point is fitting under a URL length
 * budget. Platform-native, so "zero dependency" (this task's own words) is literal, not just
 * "no new npm package." */
function deflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(bytes, new CompressionStream('deflate-raw'));
}

function inflateRaw(bytes: Uint8Array): Promise<Uint8Array> {
  return pipeThroughStream(bytes, new DecompressionStream('deflate-raw'));
}

/** `btoa`/`atob` operate on binary strings (one Unicode code point per byte), not `Uint8Array`
 * directly — the loop is the whole reason this needs its own tiny codec instead of one call. */
function toBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(text: string): Uint8Array {
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/** `SessionDoc` → the URL-safe payload after the `d:` prefix: JSON, deflated, base64url. Public
 * (not just an internal step of `buildShareLink`) so a test can assert the exact byte budget
 * this task's "under 2kB" criterion names, independent of the size-threshold branching. */
export async function encodeInlineShare(doc: SessionDoc): Promise<string> {
  const json = new TextEncoder().encode(JSON.stringify(doc));
  const compressed = await deflateRaw(json);
  return toBase64Url(compressed);
}

/** The inverse of {@link encodeInlineShare}. `null` for anything that fails to decompress/parse/
 * validate — a corrupt or hand-edited fragment is "no share found", never a thrown error. */
export async function decodeInlineShare(payload: string): Promise<SessionDoc | null> {
  try {
    const compressed = fromBase64Url(payload);
    const json = await inflateRaw(compressed);
    return migrateSessionDoc(JSON.parse(new TextDecoder().decode(json)));
  } catch {
    return null;
  }
}

export type ParsedShareFragment = { readonly kind: 'inline'; readonly payload: string } | { readonly kind: 'server'; readonly id: string };

/** Reads a URL fragment (with or without its leading `#`) that {@link buildShareLink} produced.
 * `null` for a fragment that isn't one of this app's share links at all (an anchor a user typed,
 * an empty hash) — distinct from a share link that turns out to be corrupt, which
 * {@link resolveShareFragment} surfaces by resolving to `null` only *after* trying. */
export function parseShareFragment(fragment: string): ParsedShareFragment | null {
  const text = fragment.startsWith('#') ? fragment.slice(1) : fragment;
  if (text.startsWith(INLINE_PREFIX)) return { kind: 'inline', payload: text.slice(INLINE_PREFIX.length) };
  if (text.startsWith(SERVER_PREFIX)) return { kind: 'server', id: text.slice(SERVER_PREFIX.length) };
  return null;
}

export interface PostedSession {
  readonly id: string;
  readonly shareUrl: string;
}

export interface ShareLinkOptions {
  /** Origin + path the fragment is appended to, e.g. `location.origin + location.pathname`. */
  readonly baseUrl: string;
  readonly maxFragmentBytes?: number;
  /** `POST /api/sessions` (ADR-002). Omitting it just means a fragment over the size threshold
   * is returned anyway, long URL and all, rather than silently failing to produce a link. */
  readonly postServerSession?: (doc: SessionDoc) => Promise<PostedSession>;
}

export type ShareResult =
  | { readonly kind: 'inline'; readonly url: string; readonly sizeBytes: number }
  | { readonly kind: 'server'; readonly url: string; readonly id: string };

/**
 * Builds a shareable URL for `doc`: an inline `#d:...` fragment when it fits under
 * `maxFragmentBytes` (default {@link DEFAULT_MAX_FRAGMENT_BYTES}), otherwise a server-backed
 * `#s:<id>` short link (this task's second acceptance criterion — automatic, not a choice the
 * caller makes). The id itself is the only thing that ever reaches a query string or path
 * segment (in the `POST` call and any later `GET /api/sessions/:id>`); the fragment a person
 * actually shares never contains the pattern data in a form a server request — and therefore a
 * server access log — would ever see (this task's own "never put user data in the query string"
 * rule, applied to the whole URL a recipient opens, not only the one this function returns).
 */
export async function buildShareLink(doc: SessionDoc, options: ShareLinkOptions): Promise<ShareResult> {
  const payload = await encodeInlineShare(doc);
  const fragment = `${INLINE_PREFIX}${payload}`;
  const sizeBytes = fragment.length; // base64url + the ASCII prefix: one byte per character.
  const maxBytes = options.maxFragmentBytes ?? DEFAULT_MAX_FRAGMENT_BYTES;
  const inlineResult: ShareResult = { kind: 'inline', url: `${options.baseUrl}#${fragment}`, sizeBytes };

  if (sizeBytes <= maxBytes || !options.postServerSession) {
    // Under budget, or no server configured to fall back to — either way, the inline link is
    // what there is; an unconfigured fallback means a long URL, never a failure to produce one.
    return inlineResult;
  }
  const posted = await options.postServerSession(doc);
  return { kind: 'server', url: `${options.baseUrl}#${SERVER_PREFIX}${posted.id}`, id: posted.id };
}

export interface ResolveShareOptions {
  /** Whether a reload would currently clobber something — from `loadSession(storage) !== null`. */
  readonly hasExistingAutosave: boolean;
  /** Called only when {@link ResolveShareOptions.hasExistingAutosave} is true — this task's third
   * acceptance criterion is specifically about not asking when there is nothing to overwrite. */
  readonly confirmOverwrite: () => boolean | Promise<boolean>;
  /** `GET /api/sessions/:id` (ADR-002). Omitting it makes every `s:` fragment resolve to `null`
   * rather than throw — a share link with no server configured is "not found", not a crash. */
  readonly fetchServerSession?: (id: string) => Promise<SessionDoc | null>;
}

/**
 * The reading side of a share link: parses `fragment`, asks before overwriting an existing
 * autosave (never silently, this task's third acceptance criterion), and resolves either kind of
 * payload. `null` covers every "nothing to apply" outcome alike — not a share link, declined by
 * the user, or corrupt/not found — a caller doesn't need to distinguish them to do the right
 * thing (fall through to the existing autosave or a blank session).
 */
export async function resolveShareFragment(fragment: string, options: ResolveShareOptions): Promise<SessionDoc | null> {
  const parsed = parseShareFragment(fragment);
  if (!parsed) return null;

  if (options.hasExistingAutosave) {
    const proceed = await options.confirmOverwrite();
    if (!proceed) return null;
  }

  if (parsed.kind === 'inline') return decodeInlineShare(parsed.payload);
  if (!options.fetchServerSession) return null;
  return options.fetchServerSession(parsed.id);
}
