/**
 * P3-E-7 — the lazy theme manifest and loader.
 *
 * The manifest in the main bundle duplicates three fields (id, name, cost) of every `ThemeModule`
 * so the picker can list a theme without loading it. That is exactly the kind of copy that drifts,
 * so every bundle is loaded here and diffed against its manifest entry.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { THEME_MANIFEST, ThemeBundles, type ThemeManifestEntry } from '@client/theme-bundles';
import { ThemeRegistry } from '@themes/registry';
import { DEFAULT_DARK_THEME } from '@themes/default/theme';
import type { ThemeModule } from '@themes/types';
import { stubOffscreenCanvas } from '../render/recording-canvas';

// Pass stacks bake canvases at construction (ADR-012); jsdom has no OffscreenCanvas.
beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

describe.each(THEME_MANIFEST.map((e) => [e.id, e] as const))('manifest entry %s', (_id, entry) => {
  it('matches the module its bundle loads, field for field', async () => {
    const { bundle } = await entry.load();
    expect(bundle.theme.id).toBe(entry.id);
    expect(bundle.theme.name).toBe(entry.name);
    expect(bundle.theme.cost).toBe(entry.cost);
  });

  it('builds a fresh, non-empty pass stack each time, so a theme switch can dispose the old one', async () => {
    const { bundle } = await entry.load();
    const a = bundle.createPasses();
    const b = bundle.createPasses();
    expect(a.length).toBeGreaterThan(0);
    expect(a[0]).not.toBe(b[0]);
    for (const pass of [...a, ...b]) pass.dispose();
  });

  it('declares a background mode, and asks for ages (every shipped atmosphere theme ramps by age)', async () => {
    const { bundle } = await entry.load();
    expect(['static', 'parallax']).toContain(bundle.background);
    expect(bundle.ageBuffer).toBe(true);
  });
});

describe('the manifest', () => {
  it('lists each non-Default theme once, in picker order, with unique ids', () => {
    const ids = THEME_MANIFEST.map((e) => e.id);
    expect(ids).toEqual(['chiba-city', 'flatline', 'sids-place', 'void-walker', 'synthwave']);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

function fakeEntry(id: string, load: () => Promise<{ bundle: unknown }>): ThemeManifestEntry {
  return { id, name: `Theme ${id}`, cost: 'medium', load: load as ThemeManifestEntry['load'] };
}

describe('ThemeBundles', () => {
  it('registers every manifest entry lazily: listed, not loaded, no import yet', () => {
    const load = vi.fn(() => Promise.reject(new Error('should not be called')));
    const bundles = new ThemeBundles([fakeEntry('a', load), fakeEntry('b', load)]);
    const registry = new ThemeRegistry({ root: { setProperty: () => {} }, storage: null });
    for (const r of bundles.registrations()) registry.register(r);
    expect(registry.list().map((t) => t.id)).toEqual(['a', 'b']);
    expect(registry.isLoaded('a')).toBe(false);
    expect(bundles.get('a')).toBeUndefined();
    expect(load).not.toHaveBeenCalled();
  });

  it('remembers a bundle once its theme has loaded, by id, and not before', async () => {
    const theme: ThemeModule = { ...DEFAULT_DARK_THEME, id: 'a', name: 'Theme a' };
    const bundle = { theme, createPasses: () => [], background: 'static', ageBuffer: false };
    const bundles = new ThemeBundles([fakeEntry('a', () => Promise.resolve({ bundle }))]);
    const registry = new ThemeRegistry({ root: { setProperty: () => {} }, storage: null });
    for (const r of bundles.registrations()) registry.register(r);

    expect(bundles.get('a')).toBeUndefined();
    await registry.load('a');
    expect(bundles.get('a')).toBe(bundle);
    expect(bundles.get('default')).toBeUndefined();
  });

  it('does not remember a bundle whose import failed', async () => {
    const bundles = new ThemeBundles([fakeEntry('a', () => Promise.reject(new Error('404')))]);
    const registry = new ThemeRegistry({ root: { setProperty: () => {} }, storage: null });
    for (const r of bundles.registrations()) registry.register(r);
    await expect(registry.load('a')).rejects.toThrow('404');
    expect(bundles.get('a')).toBeUndefined();
  });
});
