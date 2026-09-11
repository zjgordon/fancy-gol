import { describe, expect, it } from 'vitest';
import { LIBRARY_THUMB_ANIMATION_CAP, createThumbDirector } from '@ui/panels/library/thumbs';

function target(id: string, x: number, y: number) {
  const el = document.createElement('img');
  el.getBoundingClientRect = () =>
    DOMRect.fromRect({ x: x - 20, y: y - 20, width: 40, height: 40 });
  return { id, el, posterUrl: `/${id}.png`, animUrl: `/${id}.apng` };
}

describe('createThumbDirector', () => {
  it('animates only visible, near-pointer cards and caps concurrency', () => {
    const many = Array.from({ length: 20 }, (_, i) => target(`p${i}`, 100 + i * 10, 100));
    const live = createThumbDirector({
      nearPx: 50,
      cap: 2,
      observe: (_el, onChange) => {
        onChange(true);
        return () => {};
      },
    });
    live.setTargets(many);
    live.setPointer(100, 100);
    const on = live.tick();
    expect(on.length).toBeLessThanOrEqual(2);
    expect(LIBRARY_THUMB_ANIMATION_CAP).toBe(12);
    expect(on).toContain('p0');
    expect(many[0]!.el.getAttribute('src')).toBe('/p0.apng');
    expect(many[19]!.el.getAttribute('src')).toBe('/p19.png');
    live.dispose();
  });
});
