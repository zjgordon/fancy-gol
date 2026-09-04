import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  attachShell,
  DEFAULT_STAGGER_MS,
  INTRO_FADE_MS,
  type ShellInputSurface,
  type ShellKeySurface,
  type Timers,
} from '@ui/components/shell';

/** Same "functional double" discipline as `tests/unit/ui/gestures.spec.ts`'s `FakeSurface`. Two
 * declared overloads (rather than one general `string`/`EventListener` signature) so this
 * satisfies `ShellKeySurface`'s narrower `'keydown'`-only shape structurally, not just at the
 * runtime level. */
class FakeSurface implements ShellKeySurface, ShellInputSurface {
  private readonly handlers = new Map<string, Set<EventListener>>();

  // The implementation signature's listener param must be able to accept whichever of the two
  // overloads above a caller used; `never` is the one type every function type is (vacuously)
  // assignable to, so it's what makes both overloads implementable without `any`.
  addEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
  addEventListener(type: string, listener: EventListener, options?: AddEventListenerOptions): void;
  addEventListener(type: string, listener: (e: never) => void): void {
    if (!this.handlers.has(type)) this.handlers.set(type, new Set());
    this.handlers.get(type)!.add(listener as EventListener);
  }

  removeEventListener(type: 'keydown', listener: (e: KeyboardEvent) => void): void;
  removeEventListener(type: string, listener: EventListener): void;
  removeEventListener(type: string, listener: (e: never) => void): void {
    this.handlers.get(type)?.delete(listener as EventListener);
  }

  dispatch(type: string, event: object): void {
    for (const fn of [...(this.handlers.get(type) ?? [])]) fn(event as Event);
  }

  listenerCount(type: string): number {
    return this.handlers.get(type)?.size ?? 0;
  }
}

class FakeTimers implements Timers {
  private readonly callbacks = new Map<number, () => void>();
  private nextHandle = 1;

  setTimeout(fn: () => void, _ms: number): number {
    const handle = this.nextHandle++;
    this.callbacks.set(handle, fn);
    return handle;
  }

  clearTimeout(handle: number): void {
    this.callbacks.delete(handle);
  }

  get pendingCount(): number {
    return this.callbacks.size;
  }

  fireAll(): void {
    const fns = [...this.callbacks.values()];
    this.callbacks.clear();
    for (const fn of fns) fn();
  }
}

function buildChromeDom(): void {
  document.body.innerHTML = `
    <div id="app">
      <canvas id="scene" width="10" height="10"></canvas>
      <div id="chrome">
        <div class="chrome-region" id="chrome-toolbar"></div>
        <div class="chrome-region" id="chrome-transport"><button>Pause</button></div>
        <div class="chrome-region" id="chrome-status"><span>0</span></div>
        <div class="chrome-region" id="chrome-panel-dock"></div>
      </div>
    </div>
  `;
}

describe('attachShell', () => {
  beforeEach(() => {
    buildChromeDom();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('throws a legible error when a required chrome region is missing', () => {
    document.body.innerHTML = '<div id="chrome"><div id="chrome-toolbar"></div></div>';
    expect(() => attachShell({ root: document })).toThrow(/chrome-transport/);
  });

  it('hands back the four regions, queried from the real DOM', () => {
    const shell = attachShell({ root: document });
    expect(shell.toolbar.id).toBe('chrome-toolbar');
    expect(shell.transport.id).toBe('chrome-transport');
    expect(shell.status.id).toBe('chrome-status');
    expect(shell.panelDock.id).toBe('chrome-panel-dock');
  });

  describe('toggleChrome / setChromeVisible', () => {
    it('starts visible and toggles a "chrome-hidden" class on #chrome, never touching the canvas', () => {
      const canvas = document.querySelector('#scene') as HTMLCanvasElement;
      const canvasWidthBefore = canvas.width;
      const canvasHeightBefore = canvas.height;
      const canvasStyleBefore = canvas.getAttribute('style');

      const shell = attachShell({ root: document });
      const chrome = document.querySelector('#chrome')!;
      expect(shell.chromeVisible).toBe(true);
      expect(chrome.classList.contains('chrome-hidden')).toBe(false);

      shell.toggleChrome();
      expect(shell.chromeVisible).toBe(false);
      expect(chrome.classList.contains('chrome-hidden')).toBe(true);

      shell.toggleChrome();
      expect(shell.chromeVisible).toBe(true);
      expect(chrome.classList.contains('chrome-hidden')).toBe(false);

      // "canvas is never resized in a way that reflows the camera" — chrome visibility never
      // touches canvas dimensions or its own style at all.
      expect(canvas.width).toBe(canvasWidthBefore);
      expect(canvas.height).toBe(canvasHeightBefore);
      expect(canvas.getAttribute('style')).toBe(canvasStyleBefore);
    });

    it('setChromeVisible(false) then (true) is idempotent-safe and matches the getter', () => {
      const shell = attachShell({ root: document });
      shell.setChromeVisible(false);
      shell.setChromeVisible(false);
      expect(shell.chromeVisible).toBe(false);
      shell.setChromeVisible(true);
      expect(shell.chromeVisible).toBe(true);
    });
  });

  describe('Tab toggling', () => {
    it('Tab on the key target toggles chrome and prevents the default (focus-navigation)', () => {
      const keyTarget = new FakeSurface();
      const shell = attachShell({ root: document, keyTarget });

      let prevented = false;
      keyTarget.dispatch('keydown', { key: 'Tab', target: null, preventDefault: () => (prevented = true) });
      expect(shell.chromeVisible).toBe(false);
      expect(prevented).toBe(true);

      keyTarget.dispatch('keydown', { key: 'Tab', target: null, preventDefault: () => {} });
      expect(shell.chromeVisible).toBe(true);
    });

    it('ignores every other key', () => {
      const keyTarget = new FakeSurface();
      const shell = attachShell({ root: document, keyTarget });
      keyTarget.dispatch('keydown', { key: 'a', target: null, preventDefault: () => {} });
      expect(shell.chromeVisible).toBe(true);
    });

    it('does not toggle while a text input is focused', () => {
      const input = document.createElement('input');
      input.type = 'text';
      document.body.appendChild(input);

      const keyTarget = new FakeSurface();
      const shell = attachShell({ root: document, keyTarget });
      keyTarget.dispatch('keydown', { key: 'Tab', target: input, preventDefault: () => {} });
      expect(shell.chromeVisible).toBe(true);
    });

    it('dispose() stops observing Tab', () => {
      const keyTarget = new FakeSurface();
      const shell = attachShell({ root: document, keyTarget });
      shell.dispose();
      keyTarget.dispatch('keydown', { key: 'Tab', target: null, preventDefault: () => {} });
      expect(shell.chromeVisible).toBe(true);
    });
  });

  describe('playIntro', () => {
    it('under reduced motion, resolves immediately with chrome fully visible and no intro class', async () => {
      const shell = attachShell({ root: document, reducedMotion: () => true });
      await shell.playIntro();
      const chrome = document.querySelector('#chrome')!;
      expect(shell.chromeVisible).toBe(true);
      expect(chrome.classList.contains('chrome-intro')).toBe(false);
    });

    it('stages a staggered fade-in and resolves once the total duration elapses', async () => {
      const timers = new FakeTimers();
      const shell = attachShell({ root: document, reducedMotion: () => false, timers, inputTarget: new FakeSurface() });
      const chrome = document.querySelector('#chrome')!;

      const done = shell.playIntro({ staggerMs: 40 });
      expect(chrome.classList.contains('chrome-intro')).toBe(true);
      expect(shell.toolbar.style.getPropertyValue('--gol-intro-delay')).toBe('0ms');
      expect(shell.transport.style.getPropertyValue('--gol-intro-delay')).toBe('40ms');
      expect(shell.status.style.getPropertyValue('--gol-intro-delay')).toBe('80ms');
      expect(shell.panelDock.style.getPropertyValue('--gol-intro-delay')).toBe('120ms');
      expect(timers.pendingCount).toBe(1);

      timers.fireAll();
      await done;

      expect(chrome.classList.contains('chrome-intro')).toBe(false);
      expect(shell.chromeVisible).toBe(true);
      expect(shell.toolbar.style.getPropertyValue('--gol-intro-delay')).toBe('');
    });

    it('any real input before completion cancels it instantly, jumping to the visible end state', async () => {
      const timers = new FakeTimers();
      const inputTarget = new FakeSurface();
      const shell = attachShell({ root: document, reducedMotion: () => false, timers, inputTarget });
      const chrome = document.querySelector('#chrome')!;

      const done = shell.playIntro();
      expect(chrome.classList.contains('chrome-intro')).toBe(true);

      inputTarget.dispatch('pointerdown', {});
      await done; // must resolve without the timer ever firing

      expect(shell.chromeVisible).toBe(true);
      expect(chrome.classList.contains('chrome-intro')).toBe(false);
      expect(timers.pendingCount).toBe(0); // the completion timer was cleared, not merely ignored
    });

    it('uses the documented default stagger and fade duration when none is given', () => {
      expect(DEFAULT_STAGGER_MS).toBe(40);
      expect(INTRO_FADE_MS).toBeGreaterThan(0);
    });
  });
});

/**
 * P1-D-1's acceptance criterion "zero literal colours/sizes in the component source" names a
 * lint rule (`P1-E-1`) that doesn't exist yet — `src/themes/`, its whole home, isn't built until
 * that task. Proven honestly now instead, the same "interim substitution" precedent
 * `ui/overlay/grid-lines.ts`'s `FadeCurve` and P1-A-2/P1-C-2's Playwright criteria already
 * established: a static source check today, formalised into a real ESLint rule once P1-E-1
 * exists (at which point this test is superseded by CI, not merely redundant with it).
 */
describe('interim "zero literal colours" substitution', () => {
  function readSource(relativePath: string): string {
    return readFileSync(join(process.cwd(), relativePath), 'utf8');
  }

  it('shell.ts (the component itself) contains no literal colour value', () => {
    const src = readSource('src/ui/components/shell.ts');
    expect(src).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(src).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });

  it("index.html's chrome styling reads colours only from var(--gol-*) tokens outside the :root definition block", () => {
    const html = readSource('src/client/index.html');
    const style = html.match(/<style>([\s\S]*?)<\/style>/)?.[1];
    if (!style) throw new Error('fixture assumption broken: no <style> block found');
    // Strip the one block allowed to hold literal token *values* — everything after it is a
    // consumer, and must reference those values only via var(--gol-*).
    const rootStart = style.indexOf(':root {');
    const rootEnd = style.indexOf('\n      }\n', rootStart);
    if (rootStart < 0 || rootEnd < 0) throw new Error('fixture assumption broken: no :root {...} block found');
    const consumerCss = style.slice(rootEnd + '\n      }\n'.length);
    expect(consumerCss).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(consumerCss).not.toMatch(/\brgba?\(|\bhsla?\(/);
  });
});
