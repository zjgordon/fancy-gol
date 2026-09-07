import { describe, expect, it, vi } from 'vitest';
import { ChunkedGrid } from '@engine/grid/chunked-grid';
import { getBuiltin } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import { CONWAY } from '@engine/rules/builtin/life';
import { BUILTIN_STAMPS } from '@ui/tools/stamp';
import type { RuleSet } from '@shared/types';
import type { SessionDoc } from '@shared/session';
import {
  DEFAULT_MAX_FRAGMENT_BYTES,
  REAL_TIMERS,
  SYSTEM_HIDDEN,
  applySessionDoc,
  buildSessionDoc,
  buildShareLink,
  captureGridRLE,
  createAutosave,
  decodeInlineShare,
  encodeInlineShare,
  gridPaintOps,
  loadSession,
  parseShareFragment,
  realSessionStorage,
  resolveShareFragment,
  writeSessionDoc,
  type PostedSession,
  type SessionStorage,
  type Timers,
  type VisibilitySource,
} from '../../../src/client/session';

function fakeStorage(): SessionStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

function fakeTimers(): Timers & { fire(): void; pendingCount: number } {
  let handle = 0;
  const pending = new Map<number, () => void>();
  return {
    get pendingCount() {
      return pending.size;
    },
    setTimeout: (fn) => {
      const id = ++handle;
      pending.set(id, fn);
      return id;
    },
    clearTimeout: (id) => void pending.delete(id),
    fire: () => {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
  };
}

function fakeVisibility(): VisibilitySource & { trigger(): void } {
  let listener: (() => void) | null = null;
  return {
    addEventListener: (_type, fn) => {
      listener = fn;
    },
    removeEventListener: () => {
      listener = null;
    },
    trigger: () => listener?.(),
  };
}

describe('captureGridRLE / gridPaintOps', () => {
  it('captures nothing from an empty grid', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' }).view();
    const { rle, origin } = captureGridRLE(grid);
    expect(rle).toBe('x = 0, y = 0\n!');
    expect(origin).toEqual({ x: 0, y: 0 });
    expect(gridPaintOps({ grid: rle, gridOrigin: origin })).toEqual([]);
  });

  it('round-trips a live pattern through world-space paint ops', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    // A tiny blinker, placed away from the origin so gridOrigin is genuinely exercised.
    grid.set(100, 100, 1);
    grid.set(101, 100, 1);
    grid.set(102, 100, 1);
    const view = grid.view();

    const { rle, origin } = captureGridRLE(view);
    const ops = gridPaintOps({ grid: rle, gridOrigin: origin });

    const restored = new ChunkedGrid({ boundary: 'infinite' });
    for (const op of ops) restored.set(op.x, op.y, op.state);
    expect(restored.get(100, 100)).toBe(1);
    expect(restored.get(101, 100)).toBe(1);
    expect(restored.get(102, 100)).toBe(1);
    expect(ops).toHaveLength(3);
  });
});

describe('buildSessionDoc / applySessionDoc', () => {
  it('restores grid, camera, ruleset, theme and tool exactly (P1-F-1 AC1, at the pure-function level)', () => {
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    grid.set(5, 5, 1);
    grid.set(6, 5, 1);

    const doc = buildSessionDoc({
      ruleset: { kind: 'builtin', id: 'conway' },
      grid: grid.view(),
      tick: 17,
      seed: 999,
      camera: { originX: 3.5, originY: -1, cellSize: 24 },
      theme: 'default',
      activeToolId: 'eraser',
    });

    const restored = applySessionDoc(doc);
    expect(restored.ruleset).toBe(getBuiltin('conway'));
    expect(restored.camera).toEqual({ originX: 3.5, originY: -1, cellSize: 24 });
    expect(restored.tick).toBe(17);
    expect(restored.seed).toBe(999);
    expect(restored.theme).toBe('default');
    expect(restored.activeToolId).toBe('eraser');

    const restoredGrid = new ChunkedGrid({ boundary: 'infinite' });
    for (const op of restored.paintOps) restoredGrid.set(op.x, op.y, op.state);
    expect(restoredGrid.get(5, 5)).toBe(1);
    expect(restoredGrid.get(6, 5)).toBe(1);
  });

  it('carries an inline ruleset through unchanged', () => {
    const inline: RuleSet = {
      id: 'user:custom',
      name: 'Custom',
      states: [],
      neighborhood: { kind: 'moore', radius: 1 },
      transition: { kind: 'totalistic', born: [3], survive: [2, 3] },
      boundary: 'toroidal',
    };
    const doc = buildSessionDoc({
      ruleset: { kind: 'inline', ruleset: inline },
      grid: new ChunkedGrid({ boundary: 'infinite' }).view(),
      tick: 0,
      seed: 1,
      camera: { originX: 0, originY: 0, cellSize: 16 },
      theme: 'default',
      activeToolId: 'brush',
    });
    expect(applySessionDoc(doc).ruleset).toEqual(inline);
  });

  it('throws a legible error for a builtin id this build no longer ships', () => {
    const doc = buildSessionDoc({
      ruleset: { kind: 'builtin', id: 'not-a-real-ruleset' },
      grid: new ChunkedGrid({ boundary: 'infinite' }).view(),
      tick: 0,
      seed: 1,
      camera: { originX: 0, originY: 0, cellSize: 16 },
      theme: 'default',
      activeToolId: 'brush',
    });
    expect(() => applySessionDoc(doc)).toThrow(RangeError);
  });
});

describe('writeSessionDoc — quota-exceeded handling (P1-F-1 AC3)', () => {
  const doc: SessionDoc = {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 1, y = 1\no!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
  };

  function quotaError(): DOMException {
    return new DOMException('quota exceeded', 'QuotaExceededError');
  }

  it('writes the full document on a normal, successful save', () => {
    const storage = fakeStorage();
    const notify = vi.fn();
    writeSessionDoc(storage, doc, notify);
    expect(JSON.parse(storage.data.get('gol.session')!)).toEqual(doc);
    expect(notify).not.toHaveBeenCalled();
  });

  it('retries with the grid dropped and notifies, never crashing, on quota-exceeded', () => {
    const notify = vi.fn();
    let calls = 0;
    const storage: SessionStorage = {
      getItem: () => null,
      setItem: (_key, value) => {
        calls += 1;
        if (calls === 1) throw quotaError();
        const parsed = JSON.parse(value) as SessionDoc;
        expect(parsed.grid).toBe('');
        expect(parsed.gridOrigin).toEqual({ x: 0, y: 0 });
        expect(parsed.theme).toBe('default'); // settings kept
      },
    };
    expect(() => writeSessionDoc(storage, doc, notify)).not.toThrow();
    expect(calls).toBe(2);
    expect(notify).toHaveBeenCalledTimes(1);
    expect(notify.mock.calls[0]?.[0]).toMatch(/settings were kept/i);
  });

  it('gives up silently (no throw, no notify) if even the reduced document does not fit', () => {
    const notify = vi.fn();
    const storage: SessionStorage = {
      getItem: () => null,
      setItem: () => {
        throw quotaError();
      },
    };
    expect(() => writeSessionDoc(storage, doc, notify)).not.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });

  it('swallows an unrelated write failure without crashing or notifying', () => {
    const notify = vi.fn();
    const storage: SessionStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('storage vanished mid-write');
      },
    };
    expect(() => writeSessionDoc(storage, doc, notify)).not.toThrow();
    expect(notify).not.toHaveBeenCalled();
  });
});

describe('loadSession', () => {
  it('returns null when storage is unavailable', () => {
    expect(loadSession(null)).toBeNull();
  });

  it('returns null when nothing has been saved', () => {
    expect(loadSession(fakeStorage())).toBeNull();
  });

  it('returns null for malformed JSON rather than throwing', () => {
    const storage = fakeStorage();
    storage.data.set('gol.session', '{not json');
    expect(() => loadSession(storage)).not.toThrow();
    expect(loadSession(storage)).toBeNull();
  });

  it('returns null for well-formed JSON that fails SessionDoc validation', () => {
    const storage = fakeStorage();
    storage.data.set('gol.session', JSON.stringify({ version: 1 }));
    expect(loadSession(storage)).toBeNull();
  });

  it('loads a validly-saved document', () => {
    const storage = fakeStorage();
    const doc: SessionDoc = {
      version: 1,
      ruleset: { kind: 'builtin', id: 'conway' },
      grid: 'x = 1, y = 1\no!',
      gridOrigin: { x: 0, y: 0 },
      tick: 3,
      seed: 9,
      camera: { originX: 0, originY: 0, cellSize: 16 },
      theme: 'default',
      toolState: { activeToolId: 'brush' },
    };
    storage.data.set('gol.session', JSON.stringify(doc));
    expect(loadSession(storage)).toEqual(doc);
  });
});

describe('createAutosave', () => {
  const doc: SessionDoc = {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: '',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
  };

  it('debounces scheduleSave: rapid calls only ever write once, after the timer fires', () => {
    const storage = fakeStorage();
    const timers = fakeTimers();
    const buildDoc = vi.fn(() => doc);
    const autosave = createAutosave({ buildDoc, storage, timers, visibility: fakeVisibility() });

    autosave.scheduleSave();
    autosave.scheduleSave();
    autosave.scheduleSave();
    expect(storage.data.has('gol.session')).toBe(false);
    expect(timers.pendingCount).toBe(1); // each call replaced the previous pending timer

    timers.fire();
    expect(buildDoc).toHaveBeenCalledTimes(1);
    expect(storage.data.has('gol.session')).toBe(true);
  });

  it('saveNow writes immediately and cancels any pending debounce', () => {
    const storage = fakeStorage();
    const timers = fakeTimers();
    const autosave = createAutosave({ buildDoc: () => doc, storage, timers, visibility: fakeVisibility() });

    autosave.scheduleSave();
    expect(timers.pendingCount).toBe(1);
    autosave.saveNow();
    expect(storage.data.has('gol.session')).toBe(true);
    expect(timers.pendingCount).toBe(0);
  });

  it('flushes immediately when visibility goes hidden, bypassing the debounce', () => {
    const storage = fakeStorage();
    const timers = fakeTimers();
    const visibility = fakeVisibility();
    const autosave = createAutosave({
      buildDoc: () => doc,
      storage,
      timers,
      visibility,
      isHidden: () => true,
    });

    visibility.trigger();
    expect(storage.data.has('gol.session')).toBe(true);
    autosave.dispose();
  });

  it('does nothing on visibilitychange when the page is not actually hidden', () => {
    const storage = fakeStorage();
    const visibility = fakeVisibility();
    createAutosave({ buildDoc: () => doc, storage, timers: fakeTimers(), visibility, isHidden: () => false });
    visibility.trigger();
    expect(storage.data.has('gol.session')).toBe(false);
  });

  it('is a no-op end to end when storage is unavailable (never touches timers)', () => {
    const timers = fakeTimers();
    const buildDoc = vi.fn(() => doc);
    const autosave = createAutosave({ buildDoc, storage: null, timers, visibility: fakeVisibility() });
    autosave.scheduleSave();
    autosave.saveNow();
    expect(timers.pendingCount).toBe(0);
    expect(buildDoc).not.toHaveBeenCalled();
  });

  it('dispose() cancels a pending save and stops listening for visibility changes', () => {
    const storage = fakeStorage();
    const timers = fakeTimers();
    const visibility = fakeVisibility();
    const autosave = createAutosave({ buildDoc: () => doc, storage, timers, visibility });

    autosave.scheduleSave();
    autosave.dispose();
    expect(timers.pendingCount).toBe(0);
    timers.fire(); // nothing left to fire, but guards against a lingering reference
    visibility.trigger(); // listener was removed; must not save
    expect(storage.data.has('gol.session')).toBe(false);
  });
});

describe('the real (non-injected) environment adapters', () => {
  it('REAL_TIMERS schedules and cancels using the real setTimeout/clearTimeout', () => {
    return new Promise<void>((resolve) => {
      const handle = REAL_TIMERS.setTimeout(() => {
        throw new Error('should have been cancelled');
      }, 10);
      REAL_TIMERS.clearTimeout(handle);
      REAL_TIMERS.setTimeout(resolve, 15);
    });
  });

  it('realSessionStorage() degrades to null when localStorage is unavailable (plain Node)', () => {
    expect(typeof localStorage).toBe('undefined');
    expect(realSessionStorage()).toBeNull();
  });

  it('SYSTEM_HIDDEN degrades to false when document is unavailable (plain Node)', () => {
    expect(typeof document).toBe('undefined');
    expect(SYSTEM_HIDDEN()).toBe(false);
  });
});

function minimalDoc(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 1, y = 1\no!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
    ...overrides,
  };
}

describe('encodeInlineShare / decodeInlineShare', () => {
  it('round-trips a document exactly through deflate + base64url', async () => {
    const doc = minimalDoc({ tick: 12, grid: 'x = 3, y = 3\nbo$2bo$3o!' });
    const payload = await encodeInlineShare(doc);
    expect(payload).toMatch(/^[A-Za-z0-9_-]+$/); // no '+', '/' or '=' padding leaked through
    await expect(decodeInlineShare(payload)).resolves.toEqual(doc);
  });

  it('returns null for a corrupt payload rather than throwing', async () => {
    await expect(decodeInlineShare('not-a-real-payload!!')).resolves.toBeNull();
  });
});

describe('parseShareFragment', () => {
  it('recognises an inline fragment, with or without a leading #', () => {
    expect(parseShareFragment('#d:abc123')).toEqual({ kind: 'inline', payload: 'abc123' });
    expect(parseShareFragment('d:abc123')).toEqual({ kind: 'inline', payload: 'abc123' });
  });

  it('recognises a server fragment', () => {
    expect(parseShareFragment('#s:cFcZvYY9yg8')).toEqual({ kind: 'server', id: 'cFcZvYY9yg8' });
  });

  it('returns null for anything that is not one of this app’s share links', () => {
    expect(parseShareFragment('')).toBeNull();
    expect(parseShareFragment('#')).toBeNull();
    expect(parseShareFragment('#some-anchor')).toBeNull();
  });
});

describe('buildShareLink', () => {
  it('produces an inline #d: link when the document fits under the budget', async () => {
    const result = await buildShareLink(minimalDoc(), { baseUrl: 'https://example.test/' });
    expect(result.kind).toBe('inline');
    if (result.kind === 'inline') {
      expect(result.url.startsWith('https://example.test/#d:')).toBe(true);
      expect(result.sizeBytes).toBeLessThan(DEFAULT_MAX_FRAGMENT_BYTES);
    }
  });

  it('falls back to a server-backed #s: link once the fragment exceeds the configured budget', async () => {
    const postServerSession = vi.fn<(doc: SessionDoc) => Promise<PostedSession>>(() =>
      Promise.resolve({ id: 'shortid123', shareUrl: 'https://example.test/#s:shortid123' }),
    );
    const result = await buildShareLink(minimalDoc(), {
      baseUrl: 'https://example.test/',
      maxFragmentBytes: 4, // deliberately tiny, so even this minimal doc exceeds it
      postServerSession,
    });
    expect(postServerSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({ kind: 'server', url: 'https://example.test/#s:shortid123', id: 'shortid123' });
  });

  it('returns a long inline link (never fails) when over budget with no server configured', async () => {
    const result = await buildShareLink(minimalDoc(), { baseUrl: 'https://example.test/', maxFragmentBytes: 4 });
    expect(result.kind).toBe('inline');
  });

  it('a glider gun session round-trips through a URL under 2 kB (P1-F-2 AC1)', async () => {
    const gun = BUILTIN_STAMPS.find((s) => s.id === 'gosper-gun');
    expect(gun).toBeDefined();
    const grid = new ChunkedGrid({ boundary: 'infinite' });
    for (const op of gridPaintOps({ grid: gun!.rle, gridOrigin: { x: 0, y: 0 } })) grid.set(op.x, op.y, op.state);

    const doc = buildSessionDoc({
      ruleset: { kind: 'builtin', id: 'conway' },
      grid: grid.view(),
      tick: 0,
      seed: 1,
      camera: { originX: 0, originY: 0, cellSize: 16 },
      theme: 'default',
      activeToolId: 'stamp',
    });

    const result = await buildShareLink(doc, { baseUrl: 'https://example.test/' });
    expect(result.kind).toBe('inline');
    if (result.kind !== 'inline') throw new Error('unreachable');
    expect(result.sizeBytes).toBeLessThan(2048);

    const fragment = result.url.slice(result.url.indexOf('#'));
    const parsed = parseShareFragment(fragment);
    expect(parsed?.kind).toBe('inline');
    const restored = parsed?.kind === 'inline' ? await decodeInlineShare(parsed.payload) : null;
    expect(restored).toEqual(doc);
  });

  it('a ~100k-cell pattern automatically switches to server-backed sharing (P1-F-2 AC2)', async () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 500, height: 500 });
    sim.seedRandom(0.4, 1); // ~100,000 live cells, deliberately poorly compressible (a soup)

    const doc = buildSessionDoc({
      ruleset: { kind: 'builtin', id: 'conway' },
      grid: sim.view(),
      tick: 0,
      seed: 1,
      camera: { originX: 0, originY: 0, cellSize: 16 },
      theme: 'default',
      activeToolId: 'brush',
    });

    const postServerSession = vi.fn<(doc: SessionDoc) => Promise<PostedSession>>(() =>
      Promise.resolve({ id: 'bigpattern1', shareUrl: 'https://example.test/#s:bigpattern1' }),
    );
    const result = await buildShareLink(doc, { baseUrl: 'https://example.test/', postServerSession });

    expect(postServerSession).toHaveBeenCalledTimes(1);
    expect(result).toEqual({
      kind: 'server',
      url: 'https://example.test/#s:bigpattern1',
      id: 'bigpattern1',
    });
    // The "short link" claim: a server-backed URL never scales with pattern size.
    expect(result.url.length).toBeLessThan(64);
  });
});

describe('resolveShareFragment', () => {
  it('returns null for a fragment that is not a share link at all, without asking anything', async () => {
    const confirmOverwrite = vi.fn(() => true);
    const resolved = await resolveShareFragment('#not-a-share-link', {
      hasExistingAutosave: true,
      confirmOverwrite,
    });
    expect(resolved).toBeNull();
    expect(confirmOverwrite).not.toHaveBeenCalled();
  });

  it('never asks when there is no existing autosave to overwrite', async () => {
    const doc = minimalDoc();
    const payload = await encodeInlineShare(doc);
    const confirmOverwrite = vi.fn(() => false); // would decline if asked -- must not be asked
    const resolved = await resolveShareFragment(`#d:${payload}`, {
      hasExistingAutosave: false,
      confirmOverwrite,
    });
    expect(confirmOverwrite).not.toHaveBeenCalled();
    expect(resolved).toEqual(doc);
  });

  it('asks before overwriting an existing autosave, and honours a decline (P1-F-2 AC3)', async () => {
    const doc = minimalDoc();
    const payload = await encodeInlineShare(doc);
    const confirmOverwrite = vi.fn(() => false);
    const resolved = await resolveShareFragment(`#d:${payload}`, {
      hasExistingAutosave: true,
      confirmOverwrite,
    });
    expect(confirmOverwrite).toHaveBeenCalledTimes(1);
    expect(resolved).toBeNull();
  });

  it('proceeds with the inline document once the user confirms the overwrite', async () => {
    const doc = minimalDoc();
    const payload = await encodeInlineShare(doc);
    const resolved = await resolveShareFragment(`#d:${payload}`, {
      hasExistingAutosave: true,
      confirmOverwrite: () => true,
    });
    expect(resolved).toEqual(doc);
  });

  it('fetches a server-backed session by id once confirmed', async () => {
    const doc = minimalDoc({ tick: 5 });
    const fetchServerSession = vi.fn((id: string) => Promise.resolve(id === 'abc123' ? doc : null));
    const resolved = await resolveShareFragment('#s:abc123', {
      hasExistingAutosave: false,
      confirmOverwrite: () => true,
      fetchServerSession,
    });
    expect(fetchServerSession).toHaveBeenCalledWith('abc123');
    expect(resolved).toEqual(doc);
  });

  it('resolves to null for a server fragment when no fetcher is configured', async () => {
    const resolved = await resolveShareFragment('#s:abc123', {
      hasExistingAutosave: false,
      confirmOverwrite: () => true,
    });
    expect(resolved).toBeNull();
  });
});
