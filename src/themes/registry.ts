/**
 * Where a theme is registered, listed, and made active (P1-E-2; Phase 1 §2.5's own file-tree
 * comment: "register / activate / list, CSS custom-property application").
 *
 * `activate(id)` is the whole point: it writes every token in the theme's `TokenSet` onto `:root`
 * as a `--gol-*` custom property and notifies subscribers with the theme's `CompiledTheme`
 * projection (`render/types.ts`'s existing `{id, palette, background}` shape) so a renderer can
 * pick it up. It does this synchronously, in one pass, with no `await`/`requestAnimationFrame`/
 * `setTimeout` anywhere in the path — that's what "instant and flicker-free" (this task's own
 * implementation note) actually means in practice: there is no intermediate frame for the browser
 * to paint with half-applied or stale tokens, because nothing here ever yields before the last
 * `setProperty` call returns.
 *
 * Every impure dependency — where tokens are written, where the choice is persisted, whether the
 * system is in dark mode, and how to hear about it changing — is injected, the same discipline
 * `ui/input/gestures.ts`'s `Clock`/`FrameScheduler`/`ReducedMotionQuery` already established, so
 * this whole module is unit-testable without a real DOM or a real `matchMedia`.
 *
 * Nothing in this file instantiates a `ThemeRegistry` for production use or registers a real
 * theme — that wiring (and the Default theme itself, P1-E-3) is a mechanical follow-up for
 * whichever task plugs a renderer and a boot sequence together, the same "this task builds the
 * seam, a later one plugs into it" split `ui/tools/registry.ts`'s own doc comment already uses.
 */
import type { CompiledTheme } from '@render/types';
import type {
  ColorTokens,
  DurationKey,
  EasingKey,
  EffectTokens,
  MotionTokens,
  RadiusKey,
  ShadowKey,
  SpaceKey,
  ThemeModule,
  TokenSet,
  TypeTokens,
} from './types';

// ---------------------------------------------------------------------------------------------
// Token flattening — TokenSet → the exact `--gol-*` names `themes/tokens.css` already documents.
// Written out explicitly, key by key, rather than a generic camelCase→kebab-case transform: it's
// the one place a mismatch with `tokens.css` would be silent, so `tests/unit/themes/registry.spec.ts`
// diffs this function's output against the CSS file's own declared names directly.
// ---------------------------------------------------------------------------------------------

type Entry = readonly [name: string, value: string];

function colorEntries(c: ColorTokens): Entry[] {
  return [
    ['--gol-color-bg', c.bg],
    ['--gol-color-surface', c.surface],
    ['--gol-color-elevated', c.elevated],
    ['--gol-color-border', c.border],
    ['--gol-color-border-strong', c.borderStrong],
    ['--gol-color-text', c.text],
    ['--gol-color-muted', c.muted],
    ['--gol-color-accent', c.accent],
    ['--gol-color-accent-strong', c.accentStrong],
    ['--gol-color-accent-pressed', c.accentPressed],
    ['--gol-color-on-accent', c.onAccent],
    ['--gol-color-scrim', c.scrim],
    ['--gol-color-danger', c.danger],
    ['--gol-color-danger-strong', c.dangerStrong],
    ['--gol-color-success', c.success],
    ['--gol-color-success-strong', c.successStrong],
  ];
}

function typeEntries(t: TypeTokens): Entry[] {
  return [
    ['--gol-font-family', t.fontFamily],
    ['--gol-font-family-mono', t.fontFamilyMono],
    ['--gol-font-size-xs', t.size.xs],
    ['--gol-font-size-sm', t.size.sm],
    ['--gol-font-size-md', t.size.md],
    ['--gol-font-size-lg', t.size.lg],
    ['--gol-font-size-xl', t.size.xl],
    ['--gol-font-size-xxl', t.size.xxl],
    ['--gol-font-weight-regular', String(t.weight.regular)],
    ['--gol-font-weight-medium', String(t.weight.medium)],
    ['--gol-font-weight-bold', String(t.weight.bold)],
    ['--gol-letter-spacing-normal', t.letterSpacing.normal],
    ['--gol-letter-spacing-wide', t.letterSpacing.wide],
  ];
}

function spaceEntries(space: Readonly<Record<SpaceKey, string>>): Entry[] {
  return (Object.keys(space) as SpaceKey[]).map((k) => [`--gol-space-${k}`, space[k]] as const);
}

function radiusEntries(radius: Readonly<Record<RadiusKey, string>>): Entry[] {
  return (Object.keys(radius) as RadiusKey[]).map((k) => [`--gol-radius-${k}`, radius[k]] as const);
}

function shadowEntries(shadow: Readonly<Record<ShadowKey, string>>): Entry[] {
  return (Object.keys(shadow) as ShadowKey[]).map((k) => [`--gol-shadow-${k}`, shadow[k]] as const);
}

function motionEntries(motion: MotionTokens): Entry[] {
  return [
    ...(Object.keys(motion.duration) as DurationKey[]).map(
      (k) => [`--gol-duration-${k}`, motion.duration[k]] as const,
    ),
    ...(Object.keys(motion.easing) as EasingKey[]).map((k) => [`--gol-ease-${k}`, motion.easing[k]] as const),
  ];
}

function effectEntries(effect: EffectTokens): Entry[] {
  return [['--gol-blur-chrome', effect.blur.chrome]];
}

/** Every `--gol-*` custom property a `TokenSet` produces, in the same grouping order as
 * `themes/tokens.css`. Exported so a test (or a future build-time step) can enumerate them
 * without duplicating this mapping. */
export function tokenEntries(tokens: TokenSet): Entry[] {
  return [
    ...colorEntries(tokens.color),
    ...typeEntries(tokens.type),
    ...spaceEntries(tokens.space),
    ...radiusEntries(tokens.radius),
    ...shadowEntries(tokens.shadow),
    ...motionEntries(tokens.motion),
    ...effectEntries(tokens.effect),
  ];
}

/** `ThemeModule` → the renderer's minimal `CompiledTheme` projection. `render/types.ts`'s own doc
 * comment already calls the eventual `themes/types.ts` an extension of this shape, not a
 * replacement — this is that promised projection, one call, no state. */
export function compileTheme(theme: ThemeModule): CompiledTheme {
  return { id: theme.id, palette: theme.palette, background: theme.tokens.color.bg };
}

// ---------------------------------------------------------------------------------------------
// Registration — a plain theme, or one that adapts to `prefers-color-scheme` (this task's own
// "Honour prefers-color-scheme for the Default theme's light/dark variants" note, generalised to
// any theme rather than special-cased to one id).
// ---------------------------------------------------------------------------------------------

/** A theme presented as two concrete variants, picked by the system colour scheme at activation
 * time and re-picked live if the scheme changes while it's the active selection. `light`/`dark`
 * are full `ThemeModule`s with their own ids (e.g. `default-light`/`default-dark`) — `id`/`name`
 * here are what a caller actually selects and sees in a theme picker (e.g. `default`/`Default`). */
export interface AdaptiveThemeModule {
  readonly kind: 'adaptive';
  readonly id: string;
  readonly name: string;
  readonly light: ThemeModule;
  readonly dark: ThemeModule;
}

export type ThemeRegistration = ThemeModule | AdaptiveThemeModule;

function isAdaptive(reg: ThemeRegistration): reg is AdaptiveThemeModule {
  return 'kind' in reg && reg.kind === 'adaptive';
}

function resolve(reg: ThemeRegistration, prefersDark: boolean): ThemeModule {
  return isAdaptive(reg) ? (prefersDark ? reg.dark : reg.light) : reg;
}

export interface ThemeSummary {
  readonly id: string;
  readonly name: string;
  readonly cost: ThemeModule['cost'];
}

function summarize(reg: ThemeRegistration): ThemeSummary {
  // An adaptive pair's two variants are expected to share a cost (light/dark differ in palette,
  // not in how expensive they are to draw) — the light variant's is the one reported.
  const cost = isAdaptive(reg) ? reg.light.cost : reg.cost;
  return { id: reg.id, name: reg.name, cost };
}

// ---------------------------------------------------------------------------------------------
// Injectable environment
// ---------------------------------------------------------------------------------------------

/** Where tokens actually get written. Real `:root`'s `CSSStyleDeclaration` already satisfies
 * this; a test hands in a plain object and asserts on calls instead of parsing computed style. */
export interface TokenTarget {
  setProperty(name: string, value: string): void;
}

export const REAL_ROOT: TokenTarget = {
  setProperty: (name, value) => document.documentElement.style.setProperty(name, value),
};

/** The same minimal storage shape `Storage` already has. Injected — like `TokenTarget` — so a
 * test never touches the real `localStorage`. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** `localStorage`, or `null` if it's unavailable or throws (private browsing, quota, a
 * server-rendered environment) — persistence degrades to "just don't remember", never a crash,
 * the same treatment this project's other storage-touching tasks are held to. */
export function realThemeStorage(): ThemeStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const probe = '__gol_theme_probe__';
    localStorage.setItem(probe, '1');
    localStorage.removeItem(probe);
    return localStorage;
  } catch {
    return null;
  }
}

/** Whether the system is currently in dark mode, injected so tests don't depend on `matchMedia` —
 * the same shape `ui/input/gestures.ts`'s `ReducedMotionQuery` already uses for the analogous
 * `prefers-reduced-motion` query. */
export type PrefersDarkQuery = () => boolean;

export const SYSTEM_PREFERS_DARK: PrefersDarkQuery = () =>
  typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches;

/** Subscribes to the system colour scheme changing; returns an unsubscribe function. Injected for
 * the same reason `PrefersDarkQuery` is — a test drives this by calling the handler directly,
 * never by faking a real `MediaQueryList`. */
export type PrefersDarkSubscribe = (onChange: () => void) => () => void;

export const SYSTEM_SCHEME_CHANGE: PrefersDarkSubscribe = (onChange) => {
  if (typeof matchMedia !== 'function') return () => {};
  const mql = matchMedia('(prefers-color-scheme: dark)');
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};

const STORAGE_KEY = 'gol.theme';

export interface ThemeRegistryOptions {
  readonly root?: TokenTarget;
  /** `null` disables persistence outright — distinct from omitting the option, which falls back
   * to `realThemeStorage()`'s own availability probe. */
  readonly storage?: ThemeStorage | null;
  readonly prefersDark?: PrefersDarkQuery;
  readonly subscribeToSchemeChange?: PrefersDarkSubscribe;
}

export type ThemeChangeListener = (event: { readonly theme: ThemeModule; readonly compiled: CompiledTheme }) => void;

export class ThemeRegistry {
  private readonly entries = new Map<string, ThemeRegistration>();
  private readonly listeners = new Set<ThemeChangeListener>();
  private readonly root: TokenTarget;
  private readonly storage: ThemeStorage | null;
  private readonly prefersDark: PrefersDarkQuery;
  private readonly subscribeToSchemeChange: PrefersDarkSubscribe;
  private unsubscribeFromScheme: (() => void) | null = null;

  private activeId: string | null = null;
  private activeTheme: ThemeModule | null = null;

  constructor(options: ThemeRegistryOptions = {}) {
    this.root = options.root ?? REAL_ROOT;
    this.storage = options.storage === undefined ? realThemeStorage() : options.storage;
    this.prefersDark = options.prefersDark ?? SYSTEM_PREFERS_DARK;
    this.subscribeToSchemeChange = options.subscribeToSchemeChange ?? SYSTEM_SCHEME_CHANGE;
  }

  /** Registers a theme (plain or `prefers-color-scheme`-adaptive). Throws on a duplicate id —
   * the same "fail loudly, not silently" discipline `ui/tools/registry.ts`'s `register` uses. */
  register(registration: ThemeRegistration): void {
    if (this.entries.has(registration.id)) {
      throw new Error(`theme "${registration.id}" is already registered`);
    }
    this.entries.set(registration.id, registration);
  }

  list(): readonly ThemeSummary[] {
    return [...this.entries.values()].map(summarize);
  }

  /** The id last passed to `activate()`, restored from storage across reloads if nothing has
   * been activated yet this session. Read-only lookup — does not itself activate anything. */
  getPersistedId(): string | null {
    if (this.activeId !== null) return this.activeId;
    return this.storage?.getItem(STORAGE_KEY) ?? null;
  }

  getActive(): ThemeModule | null {
    return this.activeTheme;
  }

  getCompiledTheme(): CompiledTheme | null {
    return this.activeTheme && compileTheme(this.activeTheme);
  }

  /** Registers a listener for every future `activate()` — including a live re-resolve triggered
   * by the system colour scheme changing while an adaptive theme is active. Returns an
   * unsubscribe function. Never called for the initial `activate()` synchronously from inside
   * `subscribe()` itself — a subscriber only ever hears about a change from *after* it subscribed,
   * the same "no surprise replay" contract an `EventTarget` listener gets. */
  subscribe(listener: ThemeChangeListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Makes `id` the active theme: resolves it (picking a light/dark variant if adaptive),
   * writes every one of its tokens onto `root` in one synchronous pass, persists the choice
   * (unless `persist: false`), and notifies every subscriber. Synchronous end to end — see this
   * file's own header note on why that's what "flicker-free" requires. Returns the resolved
   * `ThemeModule` so a caller never has to immediately turn around and call `getActive()`.
   */
  activate(id: string, options: { readonly persist?: boolean } = {}): ThemeModule {
    const registration = this.entries.get(id);
    if (!registration) {
      throw new RangeError(`no theme registered with id "${id}"`);
    }

    this.activeId = id;
    const theme = this.applyAndNotify(registration);

    if (options.persist !== false) {
      try {
        this.storage?.setItem(STORAGE_KEY, id);
      } catch {
        // Same "persistence degrades, it never crashes" treatment realThemeStorage() applies to
        // an unavailable localStorage — a quota error mid-write is no different.
      }
    }

    if (isAdaptive(registration)) {
      this.ensureSchemeSubscription();
    }

    return theme;
  }

  private applyAndNotify(registration: ThemeRegistration): ThemeModule {
    const theme = resolve(registration, this.prefersDark());
    for (const [name, value] of tokenEntries(theme.tokens)) {
      this.root.setProperty(name, value);
    }
    this.activeTheme = theme;
    const compiled = compileTheme(theme);
    for (const listener of this.listeners) listener({ theme, compiled });
    return theme;
  }

  /** Subscribed at most once, lazily, the first time an adaptive theme activates — not in the
   * constructor, so a registry that never registers an adaptive theme never touches
   * `matchMedia` at all. Live re-resolves whichever registration is currently active, so a
   * scheme flip while a *plain* theme is active is correctly a no-op. */
  private ensureSchemeSubscription(): void {
    if (this.unsubscribeFromScheme) return;
    this.unsubscribeFromScheme = this.subscribeToSchemeChange(() => {
      const active = this.activeId !== null ? this.entries.get(this.activeId) : undefined;
      if (active && isAdaptive(active)) this.applyAndNotify(active);
    });
  }

  /** Releases the scheme-change subscription, if one was made. For a registry whose lifetime is
   * shorter than the page's (a test, or a future hot-reloaded theme picker). */
  dispose(): void {
    this.unsubscribeFromScheme?.();
    this.unsubscribeFromScheme = null;
  }
}
