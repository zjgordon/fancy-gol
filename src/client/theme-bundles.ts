/**
 * P3-E-7 — the non-Default themes, loaded on demand (decision D4, planning/README.md §3.6).
 *
 * `client-js-gzip` is the floor the *initial* app has to fit under, and before this task the five
 * atmosphere themes, their effect passes and their sound packs all shipped in it (+19 kB over the
 * Phase 2 baseline). Default stays eager — it is the performance and accessibility reference and
 * must work with no network beyond the page itself. Every other theme is one dynamic `import()` of
 * a bundle module under `./theme-bundles/`: the `ThemeModule`, the pass-stack factory the theme
 * needs, and how its background and age buffer behave.
 *
 * What stays in the main bundle is the **manifest** below: id, name and cost, enough for the picker
 * and the command list to show every theme without loading any. It duplicates three fields of each
 * `ThemeModule`, so `tests/unit/client/theme-bundles.spec.ts` loads every bundle and diffs them.
 *
 * Chunk naming is not cosmetic: `vite.config.ts` names these chunks `theme-*`, and the bundle
 * bench (`tests/bench/bundle.bench.ts`) excludes exactly those from `client-js-gzip` and gates the
 * largest of them separately (`theme-chunk-gzip-max`). Add a theme here and it is measured.
 */
import type { EffectPass } from '@render/effects/pass';
import type { LazyThemeModule } from '@themes/registry';
import type { ThemeModule } from '@themes/types';

export interface ThemeBundle {
  readonly theme: ThemeModule;
  /** A fresh pass stack. The registry disposes the previous one, so never share instances. */
  readonly createPasses: () => EffectPass[];
  /** `parallax` repaints L0 when the camera moves; `static` only on theme or resize. */
  readonly background: 'static' | 'parallax';
  /** Whether the worker should track per-cell ages for this theme's palette ramp. */
  readonly ageBuffer: boolean;
}

export interface ThemeManifestEntry {
  readonly id: string;
  readonly name: string;
  readonly cost: ThemeModule['cost'];
  load(): Promise<{ readonly bundle: ThemeBundle }>;
}

/** Display order is picker order and `Mod+Shift+T` cycle order. Default is registered first, eagerly. */
export const THEME_MANIFEST: readonly ThemeManifestEntry[] = [
  { id: 'chiba-city', name: 'Chiba-City', cost: 'medium', load: () => import('./theme-bundles/chiba-city') },
  { id: 'flatline', name: 'Flatline', cost: 'medium', load: () => import('./theme-bundles/flatline') },
  { id: 'sids-place', name: "Sid's Place", cost: 'medium', load: () => import('./theme-bundles/sids-place') },
  { id: 'void-walker', name: 'Void-Walker', cost: 'high', load: () => import('./theme-bundles/void-walker') },
  { id: 'synthwave', name: 'Synthwave', cost: 'high', load: () => import('./theme-bundles/synthwave') },
];

/** Remembers each loaded bundle so the composition root can ask for a theme's passes by id. */
export class ThemeBundles {
  private readonly loaded = new Map<string, ThemeBundle>();

  constructor(private readonly manifest: readonly ThemeManifestEntry[] = THEME_MANIFEST) {}

  /** One lazy registration per manifest entry, for `ThemeRegistry.register`. */
  registrations(): LazyThemeModule[] {
    return this.manifest.map((entry) => ({
      kind: 'lazy',
      id: entry.id,
      name: entry.name,
      cost: entry.cost,
      load: async () => {
        const { bundle } = await entry.load();
        this.loaded.set(entry.id, bundle);
        return bundle.theme;
      },
    }));
  }

  /** The loaded bundle for `id`, or `undefined` before it has loaded (and for Default, which has none). */
  get(id: string): ThemeBundle | undefined {
    return this.loaded.get(id);
  }
}
