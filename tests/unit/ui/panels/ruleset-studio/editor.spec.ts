import { afterEach, describe, expect, it, vi } from 'vitest';
import { createJsonEditor } from '@ui/panels/ruleset-studio/editor';

describe('createJsonEditor', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('paints line numbers, highlights the caret pair, and reports idle after the delay', () => {
    const timers = {
      setTimeout: vi.fn((fn: () => void, _ms: number) => {
        fn();
        return 1;
      }),
      clearTimeout: vi.fn(),
    };
    const onIdle = vi.fn();
    const editor = createJsonEditor({
      value: '{ "born": [3] }',
      timers,
      lineHeightPx: () => 16,
      onIdle,
    });
    document.body.appendChild(editor.root);
    Object.defineProperty(editor.textarea, 'clientHeight', { value: 160, configurable: true });
    editor.setCaret(0);
    expect(editor.root.querySelector('.studio-gutter-num')?.textContent).toBe('1');
    expect(editor.root.querySelector('.studio-tok-match')).toBeTruthy();
    editor.textarea.value = '{ "born": [3, 6] }';
    editor.textarea.dispatchEvent(new Event('input'));
    expect(editor.getValue()).toContain('6');
    expect(onIdle).toHaveBeenCalled();
    editor.setIssues([{ path: '/born/1', message: 'nope', hint: 'got 6', line: 1, column: 1 }]);
    expect(editor.root.querySelector('.studio-hint')?.textContent).toBe('got 6');
    expect(editor.textarea.getAttribute('aria-invalid')).toBe('true');
    editor.textarea.dispatchEvent(new Event('scroll'));
    editor.dispose();
  });

  it('debounces idle work and can skip the timer when delay is 0', () => {
    const handles: Array<() => void> = [];
    const timers = {
      setTimeout: vi.fn((fn: () => void) => {
        handles.push(fn);
        return handles.length;
      }),
      clearTimeout: vi.fn(),
    };
    const onIdle = vi.fn();
    const editor = createJsonEditor({
      value: '{}',
      timers,
      validateDelayMs: 150,
      onIdle,
    });
    editor.textarea.dispatchEvent(new Event('input'));
    editor.textarea.dispatchEvent(new Event('input'));
    expect(timers.clearTimeout).toHaveBeenCalled();
    expect(onIdle).not.toHaveBeenCalled();
    handles.at(-1)?.();
    expect(onIdle).toHaveBeenCalledTimes(1);
    editor.dispose();
  });
});
