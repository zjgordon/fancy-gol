// @vitest-environment jsdom
/**
 * P3-E-10 — `LazyPanel`: a panel whose code loads on first open.
 *
 * The risk in lazy-loading a stateful panel is not the fetch, it is what happens to the calls the
 * app makes while the panel does not exist yet. These pin that nothing is lost, nothing is
 * reordered, memory stays bounded, and a panel closed mid-load does not appear later.
 */
import { describe, expect, it, vi } from 'vitest';
import { LazyPanel } from '@client/lazy-panel';
import type { PanelMeta } from '@ui/panels/meta';
import type { PanelSpec } from '@ui/shell/panel-host';

const META: PanelMeta = { id: 'demo', title: 'Demo', minWidthPx: 300 };

interface FakePanel {
  readonly spec: PanelSpec;
  readonly log: string[];
  setValue(v: string): void;
}

function fakePanel(): FakePanel {
  const log: string[] = [];
  const spec: PanelSpec = {
    ...META,
    mount: (body) => {
      log.push('mount');
      const el = document.createElement('div');
      el.className = 'real';
      body.appendChild(el);
    },
    unmount: () => void log.push('unmount'),
  };
  return { spec, log, setValue: (v) => void log.push(`set:${v}`) };
}

/** A load() the test settles by hand. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => ((resolve = res), (reject = rej)));
  return { promise, resolve, reject };
}

const flush = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

describe('the spec it registers with the panel host', () => {
  it('carries the panel identity without loading anything', () => {
    const load = vi.fn(() => Promise.resolve(fakePanel()));
    const lazy = new LazyPanel(META, load);
    expect(lazy.spec).toMatchObject({ id: 'demo', title: 'Demo', minWidthPx: 300 });
    expect(lazy.loaded).toBeNull();
    expect(load).not.toHaveBeenCalled();
  });
});

describe('first open', () => {
  it('shows a placeholder at once, then replaces it with the real panel', async () => {
    const real = fakePanel();
    const gate = deferred<FakePanel>();
    const lazy = new LazyPanel(META, () => gate.promise);
    const body = document.createElement('div');

    lazy.spec.mount(body);
    expect(body.querySelector('[role="status"]')?.textContent).toBe('Loading Demo…');
    expect(body.querySelector('.real')).toBeNull();

    gate.resolve(real);
    await flush();
    expect(body.querySelector('[role="status"]')).toBeNull();
    expect(body.querySelector('.real')).not.toBeNull();
    expect(real.log).toEqual(['mount']);
  });

  it('mounts synchronously, with no placeholder, once the panel has loaded', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    await lazy.preload();
    const body = document.createElement('div');
    lazy.spec.mount(body);
    expect(body.querySelector('[role="status"]')).toBeNull();
    expect(body.querySelector('.real')).not.toBeNull();
  });

  it('shares one load between concurrent opens and a preload', async () => {
    const load = vi.fn(() => Promise.resolve(fakePanel()));
    const lazy = new LazyPanel(META, load);
    lazy.spec.mount(document.createElement('div'));
    void lazy.preload();
    void lazy.preload();
    await flush();
    expect(load).toHaveBeenCalledTimes(1);
  });
});

describe('state set before the panel exists', () => {
  it('is applied when it loads, before it is mounted', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    lazy.apply('value', (p) => p.setValue('a'));
    lazy.spec.mount(document.createElement('div'));
    await flush();
    expect(real.log).toEqual(['set:a', 'mount']);
  });

  it('keeps only the latest call per key, and replays in the order of the latest calls', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    lazy.apply('x', (p) => p.setValue('x1'));
    lazy.apply('y', (p) => p.setValue('y1'));
    lazy.apply('x', (p) => p.setValue('x2')); // re-using a key moves it after y
    await lazy.preload();
    expect(real.log).toEqual(['set:y1', 'set:x2']); // nothing lost beyond superseded writes; order preserved
  });

  it('stays bounded: a per-frame setter while closed keeps one closure, not a queue', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    for (let frame = 0; frame < 10_000; frame++) lazy.apply('live', (p) => p.setValue(`f${frame}`));
    await lazy.preload();
    expect(real.log).toEqual(['set:f9999']);
  });

  it('applies straight through once loaded', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    await lazy.preload();
    lazy.apply('value', (p) => p.setValue('now'));
    expect(real.log).toEqual(['set:now']);
  });
});

describe('closing', () => {
  it('does not mount a panel that was closed while it loaded, but has it ready next time', async () => {
    const real = fakePanel();
    const gate = deferred<FakePanel>();
    const lazy = new LazyPanel(META, () => gate.promise);
    const body = document.createElement('div');
    lazy.spec.mount(body);
    lazy.spec.unmount?.(body);
    gate.resolve(real);
    await flush();
    expect(real.log).toEqual([]); // never mounted into a body nobody is looking at

    const next = document.createElement('div');
    lazy.spec.mount(next);
    expect(next.querySelector('.real')).not.toBeNull();
  });

  it('unmounts the real panel it mounted, and not a panel it never mounted', async () => {
    const real = fakePanel();
    const lazy = new LazyPanel(META, () => Promise.resolve(real));
    await lazy.preload();
    const body = document.createElement('div');
    lazy.spec.mount(body);
    lazy.spec.unmount?.(body);
    expect(real.log).toEqual(['mount', 'unmount']);

    const never = new LazyPanel(META, () => new Promise<FakePanel>(() => {}));
    expect(() => never.spec.unmount?.(document.createElement('div'))).not.toThrow();
  });

  it('does not swap in the panel if a different panel has taken the body meanwhile', async () => {
    const real = fakePanel();
    const gate = deferred<FakePanel>();
    const lazy = new LazyPanel(META, () => gate.promise);
    const first = document.createElement('div');
    lazy.spec.mount(first);
    lazy.spec.unmount?.(first);
    const second = document.createElement('div');
    lazy.spec.mount(second); // opened again, still loading
    gate.resolve(real);
    await flush();
    expect(first.querySelector('.real')).toBeNull();
    expect(second.querySelector('.real')).not.toBeNull();
    expect(real.log).toEqual(['mount']);
  });
});

describe('a failed load', () => {
  it('says so in the panel body, tells the reload story, and reports once', async () => {
    const onLoadError = vi.fn();
    const lazy = new LazyPanel(META, () => Promise.reject(new Error('chunk 404')), { onLoadError });
    const body = document.createElement('div');
    lazy.spec.mount(body);
    await flush();
    const alert = body.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe("Couldn't load the Demo panel. Reload the page to try again.");
    expect(onLoadError).toHaveBeenCalledTimes(1);

    // Closing and reopening fails fast with the same message; it does not pretend to retry.
    lazy.spec.unmount?.(body);
    const again = document.createElement('div');
    lazy.spec.mount(again);
    await flush();
    expect(again.querySelector('[role="alert"]')).not.toBeNull();
    expect(onLoadError).toHaveBeenCalledTimes(1);
  });

  it('leaves recorded state un-applied rather than half-applying it', async () => {
    const lazy = new LazyPanel<FakePanel>(META, () => Promise.reject(new Error('nope')));
    const fn = vi.fn();
    lazy.apply('k', fn);
    lazy.spec.mount(document.createElement('div'));
    await flush();
    expect(fn).not.toHaveBeenCalled();
    expect(lazy.loaded).toBeNull();
  });
});
