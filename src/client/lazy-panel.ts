/**
 * P3-E-10 — a panel whose code loads the first time it is opened.
 *
 * The Statistics, Library and Ruleset Studio panels are a large share of the entry chunk, but a
 * session may never open one. A `LazyPanel` registers a spec with the panel host immediately, so
 * every shortcut and button that opens a panel *by id* works unchanged; the spec mounts a
 * placeholder, fetches the chunk, then mounts the real panel in its place.
 *
 * **State set before the panel exists is not lost.** The composition root keeps driving a panel
 * (`updateLive` every frame, the active ruleset, the catalogue) whether or not it has loaded.
 * `apply(key, fn)` runs `fn` now if the panel exists; otherwise it remembers the *latest* `fn` per
 * key and runs each once, in the order they were last called, as soon as the panel loads and
 * before it is mounted. Last-write-wins is right for setters, and it bounds the memory: a 60 Hz
 * `updateLive` while the panel is closed keeps one closure, not an unbounded queue.
 *
 * A failed load shows a legible message in the panel body. A browser caches a failed dynamic
 * `import()` for the page's lifetime, so retrying in place cannot work and the message says to
 * reload (the same finding, and the same copy, as the lazy themes in P3-E-7).
 */
import type { PanelMeta } from '@ui/panels/meta';
import type { PanelSpec } from '@ui/shell/panel-host';

export interface LazyPanelOptions {
  /** Called once if the chunk fails to load, so the failure is logged somewhere other than a panel body. */
  readonly onLoadError?: (error: unknown) => void;
}

export class LazyPanel<P extends { readonly spec: PanelSpec }> {
  readonly spec: PanelSpec;
  private panel: P | null = null;
  private loading: Promise<P> | null = null;
  private readonly pending = new Map<string, (panel: P) => void>();
  private mountedBody: HTMLElement | null = null;
  private realMounted = false;

  constructor(
    private readonly meta: PanelMeta,
    private readonly load: () => Promise<P>,
    private readonly options: LazyPanelOptions = {},
  ) {
    this.spec = {
      id: meta.id,
      title: meta.title,
      minWidthPx: meta.minWidthPx,
      mount: (body) => this.mount(body),
      unmount: (body) => this.unmount(body),
    };
  }

  /** The real panel once it has loaded, else `null`. */
  get loaded(): P | null {
    return this.panel;
  }

  /**
   * Run `fn` against the panel now, or remember it (latest per `key` wins) and run it once the panel
   * has loaded. Re-using a key moves it to the end, so replay order is the order of the latest calls.
   */
  apply(key: string, fn: (panel: P) => void): void {
    if (this.panel) {
      fn(this.panel);
      return;
    }
    this.pending.delete(key);
    this.pending.set(key, fn);
  }

  /** Start loading without opening (a hover or focus, say). Concurrent callers share one load. */
  preload(): Promise<P> {
    if (this.panel) return Promise.resolve(this.panel);
    if (!this.loading) {
      this.loading = this.load().then((panel) => {
        this.panel = panel;
        const replay = [...this.pending.values()];
        this.pending.clear();
        for (const fn of replay) fn(panel);
        return panel;
      });
      // A failed import is cached by the browser, so keep the rejected promise: a second open fails
      // fast with the same message instead of pretending to retry.
      this.loading.catch((error: unknown) => this.options.onLoadError?.(error));
    }
    return this.loading;
  }

  private mount(body: HTMLElement): void {
    this.mountedBody = body;
    if (this.panel) {
      this.mountReal(body);
      return;
    }
    body.replaceChildren(this.message('status', `Loading ${this.meta.title}…`));
    this.preload().then(
      () => {
        // Still open, still this body: swap the placeholder for the real thing. If the user closed
        // the panel (or opened another) while it loaded, leave it alone; it is ready for next time.
        if (this.mountedBody === body && !this.realMounted) {
          body.replaceChildren();
          this.mountReal(body);
        }
      },
      () => {
        if (this.mountedBody === body) {
          body.replaceChildren(
            this.message('alert', `Couldn't load the ${this.meta.title} panel. Reload the page to try again.`),
          );
        }
      },
    );
  }

  private mountReal(body: HTMLElement): void {
    this.panel!.spec.mount(body);
    this.realMounted = true;
  }

  private unmount(body: HTMLElement): void {
    if (this.realMounted && this.panel) this.panel.spec.unmount?.(body);
    this.realMounted = false;
    this.mountedBody = null;
  }

  private message(role: 'status' | 'alert', text: string): HTMLElement {
    const el = document.createElement('p');
    el.className = 'panel-lazy-message';
    el.setAttribute('role', role);
    el.textContent = text;
    return el;
  }
}
