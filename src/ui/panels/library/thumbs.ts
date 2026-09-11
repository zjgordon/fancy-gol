/**
 * Library thumbnail animation (P2-B-3). APNGs play only when a card is
 * on screen *and* the pointer is near it. A hard cap keeps a full-catalogue
 * scroll from lighting every loop at once.
 */

export const LIBRARY_THUMB_NEAR_PX = 140;
export const LIBRARY_THUMB_ANIMATION_CAP = 12;

export interface ThumbTarget {
  readonly id: string;
  readonly el: HTMLElement;
  readonly posterUrl: string | null;
  readonly animUrl: string | null;
}

export interface ThumbDirectorOptions {
  readonly nearPx?: number;
  readonly cap?: number;
  readonly observe?: (el: HTMLElement, onChange: (visible: boolean) => void) => () => void;
}

export interface ThumbDirector {
  setTargets(targets: readonly ThumbTarget[]): void;
  setPointer(x: number, y: number): void;
  tick(): readonly string[];
  dispose(): void;
}

function defaultObserve(el: HTMLElement, onChange: (visible: boolean) => void): () => void {
  if (typeof IntersectionObserver === 'undefined') {
    onChange(true);
    return () => {};
  }
  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) onChange(entry.isIntersecting);
    },
    { threshold: 0.15 },
  );
  io.observe(el);
  return () => io.disconnect();
}

function distance(el: HTMLElement, x: number, y: number): number {
  const r = el.getBoundingClientRect();
  const cx = r.left + r.width / 2;
  const cy = r.top + r.height / 2;
  return Math.hypot(x - cx, y - cy);
}

export function createThumbDirector(options: ThumbDirectorOptions = {}): ThumbDirector {
  const nearPx = options.nearPx ?? LIBRARY_THUMB_NEAR_PX;
  const cap = options.cap ?? LIBRARY_THUMB_ANIMATION_CAP;
  const observe = options.observe ?? defaultObserve;
  const visible = new Set<string>();
  const unobserve: Array<() => void> = [];
  let targets: readonly ThumbTarget[] = [];
  let pointer = { x: Number.POSITIVE_INFINITY, y: Number.POSITIVE_INFINITY };

  function apply(next: ReadonlySet<string>): void {
    for (const t of targets) {
      const on = next.has(t.id);
      const url = on ? t.animUrl : t.posterUrl;
      if (url === null) continue;
      if (t.el.getAttribute('src') !== url) t.el.setAttribute('src', url);
      t.el.classList.toggle('lib-thumb--live', on);
    }
  }

  function tick(): readonly string[] {
    const scored: { id: string; d: number }[] = [];
    for (const t of targets) {
      if (!visible.has(t.id) || !t.animUrl) continue;
      const d = distance(t.el, pointer.x, pointer.y);
      if (d <= nearPx) scored.push({ id: t.id, d });
    }
    scored.sort((a, b) => a.d - b.d);
    const next = new Set(scored.slice(0, cap).map((s) => s.id));
    apply(next);
    return [...next];
  }

  return {
    setTargets(next) {
      for (const stop of unobserve) stop();
      unobserve.length = 0;
      visible.clear();
      targets = next;
      for (const t of next) {
        if (t.posterUrl && t.el.getAttribute('src') !== t.posterUrl) t.el.setAttribute('src', t.posterUrl);
        t.el.classList.remove('lib-thumb--live');
        unobserve.push(
          observe(t.el, (isOn) => {
            if (isOn) visible.add(t.id);
            else visible.delete(t.id);
          }),
        );
      }
    },
    setPointer(x, y) {
      pointer = { x, y };
    },
    tick,
    dispose() {
      for (const stop of unobserve) stop();
      unobserve.length = 0;
      targets = [];
      visible.clear();
    },
  };
}
