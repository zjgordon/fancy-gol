import { afterEach, describe, expect, it, vi } from 'vitest';
import axe from 'axe-core';
import { createToastRegion } from '@ui/components/toast';

describe('createToastRegion', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('creates an aria-live="polite" region, appended to document.body', () => {
    const region = createToastRegion();
    expect(document.body.contains(region.root)).toBe(true);
    expect(region.root.getAttribute('aria-live')).toBe('polite');
    region.dispose();
  });

  it('show() renders the message and a dismiss control', () => {
    const region = createToastRegion();
    region.show('Flood fill stopped at 1,000,000 cells.');
    expect(region.root.textContent).toContain('Flood fill stopped at 1,000,000 cells.');
    expect(region.root.querySelector('button[aria-label]')).not.toBeNull();
    region.dispose();
  });

  it('auto-dismisses after the default duration', () => {
    vi.useFakeTimers();
    const region = createToastRegion();
    region.show('Gone soon');
    expect(region.root.querySelectorAll('.toast')).toHaveLength(1);

    vi.advanceTimersByTime(4999);
    expect(region.root.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(region.root.querySelectorAll('.toast')).toHaveLength(0);
    region.dispose();
  });

  it('honours a custom duration', () => {
    vi.useFakeTimers();
    const region = createToastRegion();
    region.show('Quick', { durationMs: 100 });
    vi.advanceTimersByTime(99);
    expect(region.root.querySelectorAll('.toast')).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(region.root.querySelectorAll('.toast')).toHaveLength(0);
    region.dispose();
  });

  it('a manual dismiss click removes the toast immediately, before its timer fires', () => {
    vi.useFakeTimers();
    const region = createToastRegion();
    region.show('Dismiss me');
    region.root.querySelector<HTMLButtonElement>('.toast-dismiss')!.click();
    expect(region.root.querySelectorAll('.toast')).toHaveLength(0);
    region.dispose();
  });

  it('toasts stack — multiple show() calls coexist', () => {
    const region = createToastRegion();
    region.show('First');
    region.show('Second');
    expect(region.root.querySelectorAll('.toast')).toHaveLength(2);
    region.dispose();
  });

  it('dispose() removes the region and cancels pending auto-dismiss timers', () => {
    vi.useFakeTimers();
    const region = createToastRegion();
    region.show('Pending');
    region.dispose();
    expect(document.body.contains(region.root)).toBe(false);
    // No pending timer callback should touch a removed node's children.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
  });

  it('has zero axe-core violations with a toast showing', async () => {
    const region = createToastRegion();
    region.show('Flood fill stopped at 1,000,000 cells.');
    const results = await axe.run(region.root);
    expect(results.violations).toEqual([]);
    region.dispose();
  });
});
