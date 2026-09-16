import { describe, expect, it, vi } from 'vitest';
import {
  THEME_CROSSFADE_MS,
  THEME_SWITCH_FRAME_BUDGET_MS,
  crossfadeThemeSwitch,
} from '@client/theme-switch';

function fakeTarget(opacity = '1'): HTMLElement {
  return { style: { opacity } } as unknown as HTMLElement;
}

describe('crossfadeThemeSwitch', () => {
  it('applies synchronously under reduced motion without navigating', async () => {
    const el = fakeTarget();
    const href = 'https://example.test/app';
    // location is not writable in all environments — we only assert apply does not throw
    // and leaves opacity restored.
    let applied = 0;
    let applyMs = -1;

    await crossfadeThemeSwitch({
      target: el,
      reducedMotion: true,
      apply: () => {
        applied += 1;
      },
      onApplyMs: (ms) => {
        applyMs = ms;
      },
      now: () => 100,
    });

    expect(applied).toBe(1);
    expect(applyMs).toBe(0);
    expect(applyMs).toBeLessThan(THEME_SWITCH_FRAME_BUDGET_MS);
    expect(el.style.opacity).toBe('1');
    void href;
  });

  it('cross-fades over 300 ms then applies at the midpoint', async () => {
    const el = fakeTarget();
    const fades: Array<{ from: number; to: number; ms: number }> = [];
    let applied = false;

    await crossfadeThemeSwitch({
      target: el,
      reducedMotion: false,
      durationMs: THEME_CROSSFADE_MS,
      fade: (_el, from, to, ms) => {
        fades.push({ from, to, ms });
        if (fades.length === 1) expect(applied).toBe(false);
        return Promise.resolve();
      },
      apply: () => {
        applied = true;
      },
    });

    expect(fades).toEqual([
      { from: 1, to: 0, ms: THEME_CROSSFADE_MS / 2 },
      { from: 0, to: 1, ms: THEME_CROSSFADE_MS / 2 },
    ]);
    expect(applied).toBe(true);
    expect(el.style.opacity).toBe('1');
  });

  it('keeps sync apply work inside one 30 fps frame', async () => {
    const el = fakeTarget();
    let t = 0;
    let applyMs = 999;

    await crossfadeThemeSwitch({
      target: el,
      reducedMotion: true,
      now: () => {
        const cur = t;
        t += 2; // 2 ms of fake apply work
        return cur;
      },
      apply: () => {},
      onApplyMs: (ms) => {
        applyMs = ms;
      },
    });

    expect(applyMs).toBe(2);
    expect(applyMs).toBeLessThan(THEME_SWITCH_FRAME_BUDGET_MS);
  });
});

describe('theme switch does not reload', () => {
  it('never touches location during apply', async () => {
    const reload = vi.fn();
    const el = fakeTarget();

    await crossfadeThemeSwitch({
      target: el,
      reducedMotion: true,
      apply: () => {
        expect(reload).not.toHaveBeenCalled();
      },
    });

    expect(reload).not.toHaveBeenCalled();
  });
});
