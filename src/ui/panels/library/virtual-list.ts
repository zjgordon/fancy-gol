/**
 * Hand-written windowing for the library grid (P2-B-3). Only the visible
 * slice (plus a small overscan) exists in the DOM — 200 animated
 * thumbnails would miss the frame budget.
 */

export interface VirtualListOptions<T> {
  readonly itemHeight: number;
  readonly overscan?: number;
  render(item: T, index: number): HTMLElement;
  readonly onVisibleChange?: (items: readonly T[]) => void;
}

export interface VirtualList<T> {
  readonly root: HTMLElement;
  readonly viewport: HTMLElement;
  setItems(items: readonly T[]): void;
  getVisibleCount(): number;
  scrollToIndex(index: number): void;
  dispose(): void;
}

export function attachVirtualList<T>(options: VirtualListOptions<T>): VirtualList<T> {
  const overscan = options.overscan ?? 4;
  let items: readonly T[] = [];
  let visibleCount = 0;

  const root = document.createElement('div');
  root.className = 'lib-virtual';

  const viewport = document.createElement('div');
  viewport.className = 'lib-virtual-viewport';
  viewport.tabIndex = 0;

  const spacer = document.createElement('div');
  spacer.className = 'lib-virtual-spacer';

  const slice = document.createElement('div');
  slice.className = 'lib-virtual-slice';

  spacer.appendChild(slice);
  viewport.appendChild(spacer);
  root.appendChild(viewport);

  function paint(): void {
    const rowH = options.itemHeight;
    const viewH = viewport.clientHeight || rowH * 8;
    const total = items.length;
    spacer.style.height = `${total * rowH}px`;
    const start = Math.max(0, Math.floor(viewport.scrollTop / rowH) - overscan);
    const end = Math.min(total, Math.ceil((viewport.scrollTop + viewH) / rowH) + overscan);
    visibleCount = Math.max(0, end - start);
    slice.style.transform = `translateY(${start * rowH}px)`;
    const next: T[] = [];
    const nodes: HTMLElement[] = [];
    for (let i = start; i < end; i++) {
      const item = items[i]!;
      next.push(item);
      nodes.push(options.render(item, i));
    }
    slice.replaceChildren(...nodes);
    options.onVisibleChange?.(next);
  }

  viewport.addEventListener('scroll', paint, { passive: true });

  return {
    root,
    viewport,
    setItems(next) {
      items = next;
      paint();
    },
    getVisibleCount: () => visibleCount,
    scrollToIndex(index) {
      viewport.scrollTop = Math.max(0, index * options.itemHeight);
      paint();
    },
    dispose() {
      viewport.removeEventListener('scroll', paint);
      root.remove();
    },
  };
}
