/**
 * P3-E-10 — the three lazy panel facades.
 *
 * `lazy-panel.spec.ts` proves the mechanism. These prove each facade hands the *right state* to
 * the panel it creates late: the newest tokens and document, the replayed catalogue, and charts
 * that exist before an export. The panel modules are replaced with recording fakes, so what is
 * under test is the facade's own logic — which values reach the factory, and in what order.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MotionSignature, TokenSet } from '@themes/types';

const calls: string[] = [];
const created: Record<string, unknown>[] = [];

vi.mock('@ui/panels/statistics/panel', () => ({
  createStatisticsPanel: (opts: Record<string, unknown>) => {
    created.push(opts);
    calls.push('stats:create');
    return {
      spec: { id: 'stats', title: 'Statistics', minWidthPx: 280, mount: () => {} },
      setTokens: (t: unknown) => calls.push(`stats:setTokens:${JSON.stringify(t)}`),
      setMotion: (m: unknown) => calls.push(`stats:setMotion:${JSON.stringify(m)}`),
      updateLive: (l: unknown) => calls.push(`stats:updateLive:${JSON.stringify(l)}`),
      setWindow: (w: unknown, r: unknown) => calls.push(`stats:setWindow:${JSON.stringify([w, r])}`),
      snapshotCharts: (scale: number) => [{ name: `chart@${scale}`, canvas: {} }],
    };
  },
}));
vi.mock('@ui/charts/chart', () => ({
  chartTokensFromSet: (t: { tag: string }) => ({ converted: t.tag }),
}));
vi.mock('@ui/panels/library/panel', () => ({
  createLibraryPanel: (opts: Record<string, unknown>) => {
    created.push(opts);
    calls.push('library:create');
    return {
      spec: { id: 'library', title: 'Library', minWidthPx: 320, mount: () => {} },
      setEntries: (e: unknown, s: unknown) => calls.push(`library:setEntries:${JSON.stringify([e, s])}`),
      setActiveRuleset: (id: string) => calls.push(`library:setActive:${id}`),
    };
  },
}));
vi.mock('@ui/panels/ruleset-studio/panel', () => ({
  createRulesetStudioPanel: (opts: Record<string, unknown>) => {
    created.push(opts);
    calls.push('studio:create');
    return {
      spec: { id: 'studio', title: 'Ruleset Studio', minWidthPx: 400, mount: () => {} },
      setDocument: (d: unknown) => calls.push(`studio:setDocument:${JSON.stringify(d)}`),
    };
  },
}));

import { createLazyLibraryPanel, createLazyStatisticsPanel, createLazyStudioPanel } from '@client/lazy-panels';

const tokens = (tag: string) => ({ tag }) as unknown as TokenSet;
const motion = (tag: string) => ({ tag }) as unknown as MotionSignature;

beforeEach(() => {
  calls.length = 0;
  created.length = 0;
});

describe('identity, available before anything loads', () => {
  it('each facade registers its panel by id, title and width, with no import yet', () => {
    const stats = createLazyStatisticsPanel({
      tokens: tokens('t'),
      motion: motion('m'),
      onOpen: () => {},
      onClose: () => {},
      onExport: () => {},
    });
    const library = createLazyLibraryPanel({
      entries: [],
      catalogSource: 'bundled',
      activeRuleset: 'conway',
      onPick: () => {},
      onIsolate: () => {},
    });
    const studio = createLazyStudioPanel({ initialDocument: {}, validate: () => ({ ok: true, value: {} }) });
    expect(stats.spec).toMatchObject({ id: 'stats', title: 'Statistics', minWidthPx: 280 });
    expect(library.spec).toMatchObject({ id: 'library', title: 'Library', minWidthPx: 320 });
    expect(studio.spec).toMatchObject({ id: 'studio', title: 'Ruleset Studio', minWidthPx: 400 });
    expect(calls).toEqual([]);
  });
});

describe('Statistics', () => {
  function make() {
    const onOpen = vi.fn();
    const panel = createLazyStatisticsPanel({
      tokens: tokens('dark'),
      motion: motion('calm'),
      onOpen,
      onClose: () => {},
      onExport: () => {},
    });
    return { panel, onOpen };
  }

  it('is born in the newest theme, converting tokens only now that the charts module has loaded', async () => {
    const { panel } = make();
    panel.setTokens(tokens('synthwave')); // the theme changed while the panel did not exist
    panel.setMotion(motion('bouncy'));
    await panel.preload();
    expect(created[0]).toMatchObject({ tokens: { converted: 'synthwave' }, motion: { tag: 'bouncy' } });
  });

  it('replays only the latest live numbers and window, after creation', async () => {
    const { panel } = make();
    panel.updateLive({ tick: 1 } as never);
    panel.updateLive({ tick: 2 } as never);
    panel.setWindow({ n: 1 } as never, { r: 1 } as never);
    panel.setWindow({ n: 2 } as never, { r: 2 } as never);
    await panel.preload();
    expect(calls).toEqual(['stats:create', 'stats:updateLive:{"tick":2}', 'stats:setWindow:[{"n":2},{"r":2}]']);
  });

  it('forwards straight through once loaded, converting tokens', async () => {
    const { panel } = make();
    await panel.preload();
    calls.length = 0;
    panel.setTokens(tokens('light'));
    panel.setMotion(motion('snappy'));
    panel.updateLive({ tick: 9 } as never);
    expect(calls).toEqual([
      'stats:setTokens:{"converted":"light"}',
      'stats:setMotion:{"tag":"snappy"}',
      'stats:updateLive:{"tick":9}',
    ]);
  });

  it('loads the panel before snapshotting charts, so an export works even if it was never opened', async () => {
    const { panel } = make();
    const snaps = await panel.snapshotCharts(2, (c) => c);
    expect(calls).toEqual(['stats:create']);
    expect(snaps).toEqual([{ name: 'chart@2', canvas: {} }]);
  });

  it('hands the open and close callbacks to the real panel', async () => {
    const { panel, onOpen } = make();
    await panel.preload();
    (created[0]!['onOpen'] as () => void)();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });
});

describe('Library', () => {
  const make = (over: Partial<Parameters<typeof createLazyLibraryPanel>[0]> = {}) =>
    createLazyLibraryPanel({
      entries: [{ id: 'glider' }] as never,
      catalogSource: 'bundled',
      activeRuleset: 'conway',
      onPick: () => {},
      onIsolate: () => {},
      ...over,
    });

  it('replays the starting catalogue and ruleset after creation', async () => {
    await make().preload();
    expect(calls).toEqual([
      'library:create',
      'library:setEntries:[[{"id":"glider"}],"bundled"]',
      'library:setActive:conway',
    ]);
  });

  it('lets later changes supersede the starting state, keeping the order of the latest calls', async () => {
    const panel = make();
    panel.setActiveRuleset('highlife');
    panel.setEntries([{ id: 'pulsar' }] as never, 'api');
    await panel.preload();
    expect(calls).toEqual([
      'library:create',
      'library:setActive:highlife',
      'library:setEntries:[[{"id":"pulsar"}],"api"]',
    ]);
  });

  it('passes its pick and isolate handlers to the real panel, and nothing it replays', async () => {
    const onPick = vi.fn();
    const onIsolate = vi.fn();
    await make({ onPick, onIsolate }).preload();
    expect(Object.keys(created[0]!).sort()).toEqual(['onIsolate', 'onPick']);
    (created[0]!['onPick'] as (id: string) => void)('x');
    expect(onPick).toHaveBeenCalledWith('x');
  });
});

describe('Ruleset Studio', () => {
  it('opens on the newest document, pretty-printed, not the one it was constructed with', async () => {
    const validate = vi.fn();
    const panel = createLazyStudioPanel({ initialDocument: { id: 'conway' }, validate });
    panel.setDocument({ id: 'highlife' }); // e.g. "edit this ruleset" before the studio was ever opened
    await panel.preload();
    expect(created[0]!['initialText']).toBe(JSON.stringify({ id: 'highlife' }, null, 2));
    expect(created[0]!['validate']).toBe(validate);
    expect('initialDocument' in created[0]!).toBe(false);
    expect(calls).toEqual(['studio:create']); // creation carried it: no redundant replay
  });

  it('forwards setDocument once loaded', async () => {
    const panel = createLazyStudioPanel({ initialDocument: {}, validate: () => ({ ok: true, value: {} }) });
    await panel.preload();
    calls.length = 0;
    panel.setDocument({ id: 'x' });
    expect(calls).toEqual(['studio:setDocument:{"id":"x"}']);
  });
});

describe('a failed load', () => {
  it('preload() on the handle swallows a failed import, so a hover cannot raise an unhandled rejection', async () => {
    vi.resetModules();
    vi.doMock('@ui/panels/ruleset-studio/panel', () => {
      throw new Error('chunk 404');
    });
    const { createLazyStudioPanel: fresh } = await import('@client/lazy-panels');
    const panel = fresh({ initialDocument: {}, validate: () => ({ ok: true, value: {} }) });
    await expect(panel.preload()).resolves.toBeUndefined();
    vi.doUnmock('@ui/panels/ruleset-studio/panel');
  });

  it('reports the failure through onLoadError exactly once', async () => {
    vi.resetModules();
    vi.doMock('@ui/panels/library/panel', () => {
      throw new Error('chunk 404');
    });
    const { createLazyLibraryPanel: fresh } = await import('@client/lazy-panels');
    const onLoadError = vi.fn();
    const panel = fresh({
      entries: [],
      catalogSource: 'bundled',
      activeRuleset: 'conway',
      onPick: () => {},
      onIsolate: () => {},
      onLoadError,
    });
    await panel.preload();
    await panel.preload();
    expect(onLoadError).toHaveBeenCalledTimes(1);
    vi.doUnmock('@ui/panels/library/panel');
  });
});
