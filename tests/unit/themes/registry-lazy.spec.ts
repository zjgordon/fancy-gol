/**
 * P3-E-7 — lazy theme registrations (decision D4).
 *
 * A lazy theme is listable and selectable from its manifest alone; its module arrives through a
 * dynamic import. These pin the contract the composition root relies on: nothing loads until asked,
 * concurrent loads share one fetch, a failed load is retryable and leaves the active theme alone,
 * and `activate()` refuses a theme that has not been loaded rather than half-applying it.
 */
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_DARK_THEME } from '@themes/default/theme';
import { ThemeNotLoadedError, ThemeRegistry, type LazyThemeModule, type ThemeStorage } from '@themes/registry';
import type { ThemeModule } from '@themes/types';

function moduleFor(id: string): ThemeModule {
  return { ...DEFAULT_DARK_THEME, id, name: `Theme ${id}` };
}

function memoryStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (k) => data.get(k) ?? null, setItem: (k, v) => void data.set(k, v) };
}

function lazy(id: string, load: () => Promise<ThemeModule>): LazyThemeModule {
  return { kind: 'lazy', id, name: `Theme ${id}`, cost: 'high', load };
}

function rig() {
  const root = { setProperty: vi.fn() };
  const storage = memoryStorage();
  const registry = new ThemeRegistry({ root, storage, prefersDark: () => true, subscribeToSchemeChange: () => () => {} });
  return { registry, root, storage };
}

describe('a lazy theme before it is loaded', () => {
  it('is listed from its manifest, with no load', () => {
    const { registry } = rig();
    const load = vi.fn(() => Promise.resolve(moduleFor('a')));
    registry.register(lazy('a', load));
    expect(registry.list()).toEqual([{ id: 'a', name: 'Theme a', cost: 'high' }]);
    expect(registry.isLoaded('a')).toBe(false);
    expect(load).not.toHaveBeenCalled();
  });

  it('cannot be activated or resolved, and a refused activation changes nothing', () => {
    const { registry, root, storage } = rig();
    registry.register(lazy('a', () => Promise.resolve(moduleFor('a'))));
    const heard = vi.fn();
    registry.subscribe(heard);

    expect(() => registry.activate('a')).toThrow(ThemeNotLoadedError);
    expect(() => registry.resolve('a')).toThrow(/has not been loaded/);
    expect(registry.getActive()).toBeNull();
    expect(registry.getPersistedId()).toBeNull();
    expect(root.setProperty).not.toHaveBeenCalled();
    expect(storage.data.size).toBe(0);
    expect(heard).not.toHaveBeenCalled();
  });
});

describe('load()', () => {
  it('fetches once, caches, and makes the theme activatable', async () => {
    const { registry } = rig();
    const load = vi.fn(() => Promise.resolve(moduleFor('a')));
    registry.register(lazy('a', load));

    const module = await registry.load('a');
    expect(module.id).toBe('a');
    expect(registry.isLoaded('a')).toBe(true);
    await registry.load('a');
    expect(load).toHaveBeenCalledTimes(1);

    expect(registry.activate('a').id).toBe('a');
    expect(registry.getPersistedId()).toBe('a');
  });

  it('shares one fetch between concurrent callers', async () => {
    const { registry } = rig();
    let release!: (m: ThemeModule) => void;
    const load = vi.fn(() => new Promise<ThemeModule>((resolve) => (release = resolve)));
    registry.register(lazy('a', load));

    const first = registry.load('a');
    const second = registry.load('a');
    release(moduleFor('a'));
    expect(await first).toBe(await second);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('rejects a failed load without caching it, so a retry can succeed, and never disturbs the active theme', async () => {
    const { registry } = rig();
    registry.register(moduleFor('base'));
    registry.activate('base');
    const load = vi
      .fn<() => Promise<ThemeModule>>()
      .mockRejectedValueOnce(new Error('chunk 404'))
      .mockResolvedValueOnce(moduleFor('a'));
    registry.register(lazy('a', load));

    await expect(registry.load('a')).rejects.toThrow('chunk 404');
    expect(registry.isLoaded('a')).toBe(false);
    expect(registry.getActive()?.id).toBe('base');
    expect(registry.getPersistedId()).toBe('base');

    await expect(registry.load('a')).resolves.toMatchObject({ id: 'a' });
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('rejects a module whose id does not match its registration', async () => {
    const { registry } = rig();
    registry.register(lazy('a', () => Promise.resolve(moduleFor('not-a'))));
    await expect(registry.load('a')).rejects.toThrow(/whose id is "not-a"/);
    expect(registry.isLoaded('a')).toBe(false);
  });

  it('rejects an unknown id, and resolves a plain theme immediately', async () => {
    const { registry } = rig();
    await expect(registry.load('nope')).rejects.toBeInstanceOf(RangeError);
    registry.register(moduleFor('plain'));
    expect(registry.isLoaded('plain')).toBe(true);
    await expect(registry.load('plain')).resolves.toMatchObject({ id: 'plain' });
    expect(registry.isLoaded('nope')).toBe(false);
  });
});

describe('activating a loaded lazy theme', () => {
  it('writes its tokens, notifies subscribers, and tells them it is the persisted theme', async () => {
    const { registry, root } = rig();
    registry.register(lazy('a', () => Promise.resolve(moduleFor('a'))));
    const seen: (string | null)[] = [];
    registry.subscribe(() => seen.push(registry.getPersistedId()));
    await registry.load('a');
    registry.activate('a');
    expect(root.setProperty).toHaveBeenCalled();
    expect(seen).toEqual(['a']); // activeId is set before subscribers are told
  });
});
