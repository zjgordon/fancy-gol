import { describe, expect, it, vi } from 'vitest';
import { ChunkedGrid } from '@engine/grid/chunked-grid';
import { getBuiltin } from '@engine/rules/builtin';
import type { RuleSet } from '@shared/types';
import type { SessionDoc } from '@shared/session';
import {
  REAL_TIMERS,
  SYSTEM_HIDDEN,
  applySessionDoc,
  buildSessionDoc,
  captureGridRLE,
  createAutosave,
  gridPaintOps,
  loadSession,
  realSessionStorage,
  writeSessionDoc,
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
