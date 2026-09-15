/**
 * P3-A-6 — motion system: easing solvers, animate(), reduced motion, no forced reflow.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { animateAsync } from '@themes/motion/animate';
import { defaultMotionSignature } from '@themes/motion/choreography';
import { cubicBezier, spring, PRESET_EASINGS } from '@themes/motion/easing';
import {
  getMotionSignature,
  resetMotionRuntime,
  setMotionSignature,
  setReducedMotionQuery,
} from '@themes/motion/runtime';
import { isCssTransitionLiteral } from '../../../scripts/eslint-rules/no-css-transition-on-chrome.mjs';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

afterEach(() => {
  resetMotionRuntime();
});

describe('easing solvers', () => {
  it('cubicBezier hits endpoints and is monotonic for the standard curve', () => {
    const ease = cubicBezier(0.22, 0.61, 0.36, 1);
    expect(ease(0)).toBe(0);
    expect(ease(1)).toBe(1);
    let prev = 0;
    for (let i = 1; i <= 20; i++) {
      const y = ease(i / 20);
      expect(y).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = y;
    }
  });

  it('spring settles near 1', () => {
    const s = spring({ stiffness: 200, damping: 20 });
    expect(s(0)).toBe(0);
    expect(s(1)).toBe(1);
    expect(s(0.5)).toBeGreaterThan(0.5);
  });

  it('presets are wired', () => {
    expect(PRESET_EASINGS.linear(0.3)).toBe(0.3);
    expect(PRESET_EASINGS.standard(0)).toBe(0);
    expect(PRESET_EASINGS.standard(1)).toBe(1);
  });
});

describe('animate()', () => {
  it('reduced motion snaps to the final keyframe with no delay', async () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    setReducedMotionQuery(() => true);
    const t0 = performance.now();
    await animateAsync(el, 'enter');
    expect(performance.now() - t0).toBeLessThan(30);
    expect(el.style.opacity).toBe('1');
    el.remove();
  });

  it('plays enter and exit under a fast motion signature', async () => {
    const motion = {
      ...defaultMotionSignature(),
      durationMs: { instant: 0, fast: 16, slow: 16, slower: 16 },
    };
    setMotionSignature(motion);
    setReducedMotionQuery(() => false);
    const el = document.createElement('div');
    document.body.appendChild(el);
    await animateAsync(el, 'enter', { motion });
    expect(el.style.opacity).toBe('1');
    await animateAsync(el, 'exit', { motion });
    expect(el.style.opacity).toBe('0');
    el.remove();
  });

  it('does not force layout thrash over 100 transitions', async () => {
    // Instant path still exercises applyFrame / animate(); the important claim is that
    // animate() never reads layout properties (offsetHeight, getBoundingClientRect, …).
    setReducedMotionQuery(() => true);

    const spies = [
      vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get'),
      vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get'),
      vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get'),
      vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get'),
      vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect'),
    ];

    const el = document.createElement('div');
    document.body.appendChild(el);
    for (let i = 0; i < 100; i++) {
      await animateAsync(el, i % 2 === 0 ? 'enter' : 'exit');
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
    el.remove();
  });

  it('rAF path also avoids layout reads (single bounce enter)', async () => {
    vi.useFakeTimers();
    const motion = {
      ...defaultMotionSignature(),
      durationMs: { instant: 0, fast: 20, slow: 20, slower: 20 },
      enter: { ...defaultMotionSignature().enter, easingKey: 'bounce' as const },
    };
    setMotionSignature(motion);
    setReducedMotionQuery(() => false);
    const spy = vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get');
    const el = document.createElement('div');
    document.body.appendChild(el);
    const done = animateAsync(el, 'enter', { motion });
    await vi.runAllTimersAsync();
    await done;
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    el.remove();
    vi.useRealTimers();
  });
});

describe('runtime', () => {
  it('getMotionSignature defaults and setMotionSignature updates', () => {
    expect(getMotionSignature().enter.keyframes.length).toBeGreaterThan(0);
    const custom = defaultMotionSignature();
    setMotionSignature(custom);
    expect(getMotionSignature()).toBe(custom);
  });
});

describe('no-css-transition-on-chrome', () => {
  it('detects transition literals', () => {
    expect(isCssTransitionLiteral('transition: opacity 150ms linear')).toBe(true);
    expect(isCssTransitionLiteral('color: red')).toBe(false);
  });

  it('index.html has no transition on panel/dialog/toast/tooltip/chrome selectors', () => {
    const html = readFileSync(join(process.cwd(), 'src/client/index.html'), 'utf8');
    // Strip comments so historical notes don't trip the scan.
    const bare = html.replace(/\/\*[\s\S]*?\*\//g, '');
    const blocks = bare.match(
      /(?:#chrome|\.chrome-region|\.panel-host|\.dialog-|\.toast|\.tooltip-flyout)[^{]*\{[^}]*\}/g,
    );
    expect(blocks?.length ?? 0).toBeGreaterThan(0);
    for (const block of blocks ?? []) {
      expect(block).not.toMatch(/\btransition\s*:/);
    }
  });
});
