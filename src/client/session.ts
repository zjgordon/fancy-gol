/**
 * Session persistence (P1-F-1): turning live app state into a `SessionDoc` and back
 * (`buildSessionDoc`/`applySessionDoc`), and autosaving that document to `localStorage`,
 * debounced at 2s and flushed immediately on `visibilitychange` (`createAutosave`).
 *
 * Every impure dependency — where the document is written, how a debounce timer is scheduled,
 * how visibility changes are heard about, and how the user is notified of a degraded save — is
 * injected, the same discipline `themes/registry.ts`'s `TokenTarget`/`ThemeStorage`/
 * `PrefersDarkQuery` and `ui/components/shell.ts`'s `Timers` already established. Nothing in
 * this file wires a live `Simulation`/`Camera`/`ThemeRegistry` into `buildSessionDoc`'s
 * `SessionSnapshot` input for production use, or calls `createAutosave` from a real boot
 * sequence — that composition is a mechanical follow-up for whichever task builds `client/main.ts`'s
 * full app wiring, the same "this task builds the seam, a later one plugs into it" split
 * `themes/registry.ts`'s own header note already applies to itself.
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
