import { afterEach, describe, expect, it } from 'vitest';
import { attachVirtualList } from '@ui/panels/library/virtual-list';

describe('attachVirtualList', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('renders only the visible window, not every item', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let rendered = 0;
    const list = attachVirtualList<number>({
      itemHeight: 80,
      overscan: 2,
      render(item) {
        rendered += 1;
        const el = document.createElement('div');
        el.textContent = String(item);
        return el;
      },
    });
    host.appendChild(list.root);
    list.viewport.style.height = '240px';
    Object.defineProperty(list.viewport, 'clientHeight', { value: 240, configurable: true });
    list.setItems(Array.from({ length: 250 }, (_, i) => i));
    expect(list.getVisibleCount()).toBeLessThan(20);
    expect(rendered).toBeLessThan(20);
    expect(list.root.querySelectorAll('.lib-virtual-slice > *')).toHaveLength(list.getVisibleCount());
    list.dispose();
  });
});
