import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ThemeModule, TokenSet } from '@themes/types';
import {
  REAL_ROOT,
  SYSTEM_PREFERS_DARK,
  SYSTEM_SCHEME_CHANGE,
  ThemeRegistry,
  compileTheme,
  realThemeStorage,
  tokenEntries,
  type PrefersDarkSubscribe,
  type ThemeChangeListener,
  type ThemeStorage,
  type TokenTarget,
} from '@themes/registry';

const TEST_TOKENS: TokenSet = {
  color: {
    bg: '#0e0f11',
    surface: 'rgba(255,255,255,0.05)',
    elevated: 'rgba(255,255,255,0.09)',
    border: 'rgba(255,255,255,0.14)',
    borderStrong: 'rgba(255,255,255,0.24)',
    text: '#eef0f2',
    muted: '#9aa0a6',
    accent: '#8a97a8',
    accentStrong: '#a6b2c2',
    accentPressed: '#6f7c8c',
    onAccent: '#0e0f11',
    scrim: 'rgba(0,0,0,0.55)',
    danger: '#e5484d',
    dangerStrong: '#ff6369',
    success: '#3dd68c',
    successStrong: '#5eeaa6',
  },
  type: {
    fontFamily: 'system-ui',
    fontFamilyMono: 'ui-monospace',
    size: { xs: '11px', sm: '13px', md: '15px', lg: '18px', xl: '22px', xxl: '28px' },
    weight: { regular: 400, medium: 600, bold: 700 },
    letterSpacing: { normal: '0', wide: '0.04em' },
  },
  space: { '1': '4px', '2': '8px', '3': '12px', '4': '16px', '5': '24px', '6': '32px', '7': '48px' },
  radius: { sm: '6px', md: '8px', lg: '14px' },
  shadow: { sm: '0 2px 8px rgba(0,0,0,.25)', md: '0 8px 24px rgba(0,0,0,.35)', lg: '0 16px 48px rgba(0,0,0,.45)' },
  motion: {
    duration: { instant: '0ms', fast: '150ms', slow: '600ms', slower: '900ms' },
    easing: {
      linear: 'linear',
      standard: 'cubic-bezier(.22,.61,.36,1)',
      decelerate: 'cubic-bezier(0,0,.2,1)',
      accelerate: 'cubic-bezier(.4,0,1,1)',
      bounce: 'cubic-bezier(.34,1.56,.64,1)',
    },
  },
  effect: { blur: { chrome: 'blur(4px)' } },
};

function makeTheme(overrides: Partial<ThemeModule> = {}): ThemeModule {
  return {
    id: 'test',
    name: 'Test',
    tokens: TEST_TOKENS,
    palette: (state) => (state === 0 ? '#000000' : '#ffffff'),
    motion: {
      durationMs: { instant: 0, fast: 150, slow: 600, slower: 900 },
      easings: { linear: (t) => t, standard: (t) => t, decelerate: (t) => t, accelerate: (t) => t, bounce: (t) => t },
      enter: { delayStepMs: 40 },
    },
    cost: 'low',
    ...overrides,
  };
}

function fakeRoot(): TokenTarget & { calls: Array<[string, string]> } {
  const calls: Array<[string, string]> = [];
  return { calls, setProperty: (name, value) => calls.push([name, value]) };
}

function fakeStorage(): ThemeStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
}

describe('themes/registry.ts — tokenEntries / compileTheme (pure)', () => {
  it("produces exactly the --gol-* names themes/tokens.css declares", () => {
    const css = readFileSync(join(process.cwd(), 'src/themes/tokens.css'), 'utf8');
    const declared = [...css.matchAll(/^\s*(--gol-[a-z0-9-]+):/gm)].map((m) => m[1] as string).sort();
    const produced = tokenEntries(TEST_TOKENS)
      .map(([name]) => name)
      .sort();
    expect(produced).toEqual(declared);
  });

  it('produces a value for every entry, with numeric weights coerced to strings', () => {
    const entries = Object.fromEntries(tokenEntries(TEST_TOKENS));
    expect(entries['--gol-font-weight-medium']).toBe('600');
    expect(entries['--gol-color-accent']).toBe('#8a97a8');
    expect(entries['--gol-ease-bounce']).toBe('cubic-bezier(.34,1.56,.64,1)');
  });

  it('compiles a ThemeModule into the renderer-facing CompiledTheme shape', () => {
    const theme = makeTheme();
    const compiled = compileTheme(theme);
    expect(compiled.id).toBe('test');
    expect(compiled.background).toBe(TEST_TOKENS.color.bg);
    expect(compiled.palette(1, 0)).toBe('#ffffff');
  });
});

describe('ThemeRegistry — register/list', () => {
  it('lists every registered theme by id, name and cost', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    registry.register(makeTheme({ id: 'a', name: 'A', cost: 'low' }));
    registry.register(makeTheme({ id: 'b', name: 'B', cost: 'high' }));
    expect(registry.list()).toEqual([
      { id: 'a', name: 'A', cost: 'low' },
      { id: 'b', name: 'B', cost: 'high' },
    ]);
  });

  it('throws on a duplicate id instead of silently overwriting', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    registry.register(makeTheme({ id: 'a' }));
    expect(() => registry.register(makeTheme({ id: 'a' }))).toThrow(/already registered/);
  });

  it('summarises an adaptive registration using the wrapper id/name and the light variant cost', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null, prefersDark: () => false });
    registry.register({
      kind: 'adaptive',
      id: 'default',
      name: 'Default',
      light: makeTheme({ id: 'default-light', cost: 'low' }),
      dark: makeTheme({ id: 'default-dark', cost: 'low' }),
    });
    expect(registry.list()).toEqual([{ id: 'default', name: 'Default', cost: 'low' }]);
  });
});

describe('ThemeRegistry — activate', () => {
  it('throws RangeError for an unknown id (never a silent no-op)', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    expect(() => registry.activate('nope')).toThrow(RangeError);
  });

  it('writes every token onto root synchronously, in one pass, before returning', () => {
    const root = fakeRoot();
    const registry = new ThemeRegistry({ root, storage: null });
    registry.register(makeTheme());
    registry.activate('test');
    expect(root.calls).toHaveLength(tokenEntries(TEST_TOKENS).length);
    expect(root.calls).toContainEqual(['--gol-color-accent', '#8a97a8']);
  });

  it('updates getActive() and getCompiledTheme()', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    expect(registry.getActive()).toBeNull();
    expect(registry.getCompiledTheme()).toBeNull();
    registry.register(makeTheme());
    registry.activate('test');
    expect(registry.getActive()?.id).toBe('test');
    expect(registry.getCompiledTheme()?.background).toBe(TEST_TOKENS.color.bg);
  });

  it('notifies subscribers with the resolved theme and its compiled projection', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    registry.register(makeTheme());
    const listener = vi.fn<ThemeChangeListener>();
    registry.subscribe(listener);
    registry.activate('test');
    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0]?.[0];
    expect(event?.theme.id).toBe('test');
    expect(event?.compiled.id).toBe('test');
  });

  it('never replays past activations to a listener that subscribes afterwards', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    registry.register(makeTheme());
    registry.activate('test');
    const listener = vi.fn();
    registry.subscribe(listener);
    expect(listener).not.toHaveBeenCalled();
  });

  it('stops notifying once unsubscribed', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    registry.register(makeTheme());
    registry.register(makeTheme({ id: 'other' }));
    const listener = vi.fn();
    const unsubscribe = registry.subscribe(listener);
    registry.activate('test');
    unsubscribe();
    registry.activate('other');
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

describe('ThemeRegistry — persistence', () => {
  it('persists the activated id by default', () => {
    const storage = fakeStorage();
    const registry = new ThemeRegistry({ root: fakeRoot(), storage });
    registry.register(makeTheme());
    registry.activate('test');
    expect(storage.data.get('gol.theme')).toBe('test');
  });

  it('skips persistence when persist: false is passed', () => {
    const storage = fakeStorage();
    const registry = new ThemeRegistry({ root: fakeRoot(), storage });
    registry.register(makeTheme());
    registry.activate('test', { persist: false });
    expect(storage.data.has('gol.theme')).toBe(false);
  });

  it('getPersistedId reads storage before anything has been activated this session', () => {
    const storage = fakeStorage();
    storage.data.set('gol.theme', 'from-a-previous-session');
    const registry = new ThemeRegistry({ root: fakeRoot(), storage });
    expect(registry.getPersistedId()).toBe('from-a-previous-session');
  });

  it("getPersistedId prefers this session's own activation over stale storage", () => {
    const storage = fakeStorage();
    storage.data.set('gol.theme', 'stale');
    const registry = new ThemeRegistry({ root: fakeRoot(), storage });
    registry.register(makeTheme());
    registry.activate('test');
    expect(registry.getPersistedId()).toBe('test');
  });

  it('never throws when storage is null (unavailable) or a write fails', () => {
    const throwingStorage: ThemeStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota exceeded');
      },
    };
    const nullRegistry = new ThemeRegistry({ root: fakeRoot(), storage: null });
    const throwingRegistry = new ThemeRegistry({ root: fakeRoot(), storage: throwingStorage });
    nullRegistry.register(makeTheme());
    throwingRegistry.register(makeTheme());
    expect(() => nullRegistry.activate('test')).not.toThrow();
    expect(() => throwingRegistry.activate('test')).not.toThrow();
  });
});

describe('ThemeRegistry — prefers-color-scheme adaptive themes', () => {
  function makeAdaptive() {
    return {
      kind: 'adaptive' as const,
      id: 'default',
      name: 'Default',
      light: makeTheme({ id: 'default-light', tokens: { ...TEST_TOKENS, color: { ...TEST_TOKENS.color, bg: '#ffffff' } } }),
      dark: makeTheme({ id: 'default-dark', tokens: { ...TEST_TOKENS, color: { ...TEST_TOKENS.color, bg: '#000000' } } }),
    };
  }

  it('picks the light variant when the system is not in dark mode', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null, prefersDark: () => false });
    registry.register(makeAdaptive());
    const resolved = registry.activate('default');
    expect(resolved.id).toBe('default-light');
  });

  it('picks the dark variant when the system is in dark mode', () => {
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null, prefersDark: () => true });
    registry.register(makeAdaptive());
    const resolved = registry.activate('default');
    expect(resolved.id).toBe('default-dark');
  });

  it('never subscribes to scheme changes unless an adaptive theme is actually activated', () => {
    const subscribeToSchemeChange = vi.fn<PrefersDarkSubscribe>(() => () => {});
    const registry = new ThemeRegistry({ root: fakeRoot(), storage: null, subscribeToSchemeChange });
    registry.register(makeTheme());
    registry.activate('test');
    expect(subscribeToSchemeChange).not.toHaveBeenCalled();
  });

  it('re-resolves and re-notifies live when the system scheme flips while adaptive is active', () => {
    let prefersDark = false;
    let onChange: () => void = () => {};
    const subscribeToSchemeChange: PrefersDarkSubscribe = (cb) => {
      onChange = cb;
      return () => {};
    };
    const registry = new ThemeRegistry({
      root: fakeRoot(),
      storage: null,
      prefersDark: () => prefersDark,
      subscribeToSchemeChange,
    });
    registry.register(makeAdaptive());
    const listener = vi.fn();
    registry.activate('default');
    registry.subscribe(listener);

    prefersDark = true;
    onChange();

    expect(registry.getActive()?.id).toBe('default-dark');
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('a scheme flip is a no-op while a plain (non-adaptive) theme is active', () => {
    let onChange: () => void = () => {};
    const subscribeToSchemeChange: PrefersDarkSubscribe = (cb) => {
      onChange = cb;
      return () => {};
    };
    const registry = new ThemeRegistry({
      root: fakeRoot(),
      storage: null,
      prefersDark: () => false,
      subscribeToSchemeChange,
    });
    registry.register(makeAdaptive());
    registry.register(makeTheme({ id: 'plain' }));
    registry.activate('default'); // arms the subscription
    registry.activate('plain'); // switch away to a non-adaptive theme
    const listener = vi.fn();
    registry.subscribe(listener);

    onChange();

    expect(listener).not.toHaveBeenCalled();
    expect(registry.getActive()?.id).toBe('plain');
  });

  it('dispose() releases the scheme-change subscription', () => {
    const unsubscribe = vi.fn();
    const registry = new ThemeRegistry({
      root: fakeRoot(),
      storage: null,
      subscribeToSchemeChange: () => unsubscribe,
    });
    registry.register(makeAdaptive());
    registry.activate('default');
    registry.dispose();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe('the real (non-injected) environment adapters', () => {
  it('REAL_ROOT writes an actual --gol-* custom property onto document.documentElement', () => {
    REAL_ROOT.setProperty('--gol-color-accent', '#8a97a8');
    expect(document.documentElement.style.getPropertyValue('--gol-color-accent')).toBe('#8a97a8');
    document.documentElement.style.removeProperty('--gol-color-accent');
  });

  it('realThemeStorage() returns a working store when localStorage is available (jsdom has one)', () => {
    const storage = realThemeStorage();
    expect(storage).not.toBeNull();
    storage?.setItem('gol.theme.probe', 'x');
    expect(storage?.getItem('gol.theme.probe')).toBe('x');
  });

  it('SYSTEM_PREFERS_DARK and SYSTEM_SCHEME_CHANGE degrade to inert defaults when matchMedia is missing', () => {
    // jsdom, like every unit-test environment this project runs in, has no `matchMedia` at all —
    // exactly the "no such API here" case these two exist to survive, not just a test fixture.
    expect(typeof matchMedia).toBe('undefined');
    expect(SYSTEM_PREFERS_DARK()).toBe(false);
    const unsubscribe = SYSTEM_SCHEME_CHANGE(() => {});
    expect(() => unsubscribe()).not.toThrow();
  });
});
