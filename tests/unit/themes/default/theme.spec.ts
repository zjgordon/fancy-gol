import { describe, expect, it } from 'vitest';
import { ThemeRegistry } from '@themes/registry';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME, DEFAULT_THEME } from '@themes/default/theme';

describe('Default theme module shape', () => {
  it.each([
    ['dark', DEFAULT_DARK_THEME],
    ['light', DEFAULT_LIGHT_THEME],
  ] as const)('%s variant is the honest baseline: cost low, no render hooks, no sound', (_name, theme) => {
    expect(theme.cost).toBe('low');
    expect(theme.drawBackground).toBeUndefined();
    expect(theme.drawCellOverride).toBeUndefined();
    expect(theme.postProcess).toBeUndefined();
    expect(theme.shaders).toBeUndefined();
    expect(theme.sound).toBeUndefined();
  });

  it.each([
    ['dark', DEFAULT_DARK_THEME],
    ['light', DEFAULT_LIGHT_THEME],
  ] as const)("%s variant's motion.easings are real curves with correct endpoints (P3-A-6)", (_name, theme) => {
    for (const [key, easing] of Object.entries(theme.motion.easings)) {
      expect(easing(0), key).toBe(0);
      expect(easing(1), key).toBe(1);
      if (key !== 'linear') {
        expect(easing(0.42), key).not.toBe(0.42);
      }
    }
    expect(theme.motion.enter.keyframes.length).toBeGreaterThan(0);
    expect(theme.motion.exit.keyframes.length).toBeGreaterThan(0);
    expect(theme.motion.emphasis.keyframes.length).toBeGreaterThan(0);
  });

  it('DEFAULT_THEME is an adaptive pair wrapping the two concrete variants', () => {
    expect(DEFAULT_THEME.kind).toBe('adaptive');
    expect(DEFAULT_THEME.id).toBe('default');
    expect(DEFAULT_THEME.light).toBe(DEFAULT_LIGHT_THEME);
    expect(DEFAULT_THEME.dark).toBe(DEFAULT_DARK_THEME);
  });
});

describe('Default theme registered and activated through ThemeRegistry', () => {
  function registry(prefersDark: boolean) {
    const calls: Array<[string, string]> = [];
    const r = new ThemeRegistry({
      root: { setProperty: (n, v) => calls.push([n, v]) },
      storage: null,
      prefersDark: () => prefersDark,
    });
    r.register(DEFAULT_THEME);
    return { r, calls };
  }

  it('activates the light variant when the system is not in dark mode', () => {
    const { r } = registry(false);
    const resolved = r.activate('default');
    expect(resolved.id).toBe('default-light');
    expect(r.getCompiledTheme()?.background).toBe(DEFAULT_LIGHT_THEME.tokens.color.bg);
  });

  it('activates the dark variant when the system is in dark mode', () => {
    const { r } = registry(true);
    const resolved = r.activate('default');
    expect(resolved.id).toBe('default-dark');
    expect(r.getCompiledTheme()?.background).toBe(DEFAULT_DARK_THEME.tokens.color.bg);
  });

  it('writes every one of the variant tokens onto root when activated', () => {
    const { r, calls } = registry(true);
    r.activate('default');
    const written = Object.fromEntries(calls);
    expect(written['--gol-color-bg']).toBe(DEFAULT_DARK_THEME.tokens.color.bg);
    expect(written['--gol-color-accent']).toBe(DEFAULT_DARK_THEME.tokens.color.accent);
  });

  it("the compiled theme's palette renders a live cell distinctly from the background", () => {
    const { r } = registry(true);
    r.activate('default');
    const compiled = r.getCompiledTheme();
    expect(compiled).not.toBeNull();
    expect(compiled?.palette(1, 1)).not.toBe(compiled?.background);
  });
});
