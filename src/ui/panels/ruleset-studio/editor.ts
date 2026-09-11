/**
 * Overlay editor (P2-E-1): a transparent `<textarea>` over a syntax-highlighted `<pre>`,
 * with a virtualised gutter so a 2,000-line ruleset stays above 55 fps while typing.
 */
import { highlightRange, matchingBracket } from './highlight';
import { lineStarts } from './json-pointer';
import type { LocatedStudioIssue } from './types';

export interface EditorTimers {
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(handle: number): void;
}

export const REAL_EDITOR_TIMERS: EditorTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms) as unknown as number,
  clearTimeout: (handle) => clearTimeout(handle),
};

/** Default idle delay — the number, not the `'150ms'` token string banned in `src/ui/**`. */
export const STUDIO_VALIDATE_DELAY_MS = 150;

const FALLBACK_LINE_HEIGHT = 18;
const OVERSCAN = 3;
/** Token spans stay off the keystroke path once the document is this big — colour catches up on idle. */
const TOKEN_HIGHLIGHT_CHAR_BUDGET = 4096;

export interface JsonEditorOptions {
  readonly value?: string;
  readonly validateDelayMs?: number;
  readonly timers?: EditorTimers;
  readonly lineHeightPx?: () => number;
  readonly onChange?: (text: string) => void;
  readonly onIdle?: (text: string) => void;
}

export interface JsonEditor {
  readonly root: HTMLElement;
  readonly textarea: HTMLTextAreaElement;
  getValue(): string;
  setValue(text: string): void;
  setIssues(issues: readonly LocatedStudioIssue[]): void;
  getIssues(): readonly LocatedStudioIssue[];
  setCaret(offset: number): void;
  paint(): void;
  dispose(): void;
}

export function createJsonEditor(opts: JsonEditorOptions = {}): JsonEditor {
  const timers = opts.timers ?? REAL_EDITOR_TIMERS;
  const delay = opts.validateDelayMs ?? STUDIO_VALIDATE_DELAY_MS;
  let text = opts.value ?? '';
  let issues: readonly LocatedStudioIssue[] = [];
  let idleHandle: number | null = null;

  const root = document.createElement('div');
  root.className = 'studio-editor';

  const gutter = document.createElement('div');
  gutter.className = 'studio-gutter';
  gutter.setAttribute('aria-hidden', 'true');
  const gutterInner = document.createElement('div');
  gutterInner.className = 'studio-gutter-inner';
  gutter.appendChild(gutterInner);

  const stack = document.createElement('div');
  stack.className = 'studio-stack';

  const highlight = document.createElement('pre');
  highlight.className = 'studio-highlight';
  highlight.setAttribute('aria-hidden', 'true');
  const highlightInner = document.createElement('div');
  highlightInner.className = 'studio-highlight-inner';
  highlight.appendChild(highlightInner);

  const hints = document.createElement('div');
  hints.className = 'studio-hints';
  hints.setAttribute('aria-hidden', 'true');

  const textarea = document.createElement('textarea');
  textarea.className = 'studio-input';
  textarea.spellcheck = false;
  textarea.setAttribute('aria-label', 'Ruleset JSON');
  textarea.setAttribute('autocapitalize', 'off');
  textarea.setAttribute('autocomplete', 'off');
  textarea.setAttribute('autocorrect', 'off');
  textarea.wrap = 'off';
  textarea.value = text;

  stack.append(highlight, hints, textarea);
  root.append(gutter, stack);

  const measureLineHeight = (): number => {
    if (opts.lineHeightPx) return opts.lineHeightPx();
    const raw = getComputedStyle(textarea).lineHeight;
    if (raw.endsWith('px')) {
      const px = Number.parseFloat(raw);
      if (Number.isFinite(px) && px > 0) return px;
    }
    return FALLBACK_LINE_HEIGHT;
  };

  const scheduleIdle = (): void => {
    if (idleHandle !== null) timers.clearTimeout(idleHandle);
    const fire = (): void => {
      idleHandle = null;
      paint('full');
      opts.onIdle?.(text);
    };
    if (delay <= 0) {
      fire();
      return;
    }
    idleHandle = timers.setTimeout(fire, delay);
  };

  const paint = (mode: 'hot' | 'full' = 'full'): void => {
    const lh = measureLineHeight();
    const starts = lineStarts(text);
    const lineCount = starts.length;
    const scroll = textarea.scrollTop;
    const viewH = textarea.clientHeight || lh * 24;
    const first = Math.max(0, Math.floor(scroll / lh) - OVERSCAN);
    const last = Math.min(lineCount, Math.ceil((scroll + viewH) / lh) + OVERSCAN);
    const from = starts[first] ?? 0;
    const to = last >= lineCount ? text.length : (starts[last] ?? text.length);
    const tokenise = mode === 'full' || text.length <= TOKEN_HIGHLIGHT_CHAR_BUDGET;
    if (tokenise) {
      highlightInner.innerHTML = highlightRange(text, from, to, matchingBracket(text, textarea.selectionStart));
    } else {
      highlightInner.textContent = text.slice(from, to);
    }
    highlightInner.style.transform = `translateY(${String(first * lh - scroll)}px)`;

    const byLine = new Map<number, LocatedStudioIssue[]>();
    for (const issue of issues) {
      const list = byLine.get(issue.line) ?? [];
      list.push(issue);
      byLine.set(issue.line, list);
    }
    const visible = last - first;
    while (gutterInner.childElementCount < visible) {
      const row = document.createElement('div');
      row.className = 'studio-gutter-line';
      const num = document.createElement('span');
      num.className = 'studio-gutter-num';
      const mark = document.createElement('span');
      mark.className = 'studio-gutter-mark';
      mark.textContent = '!';
      mark.hidden = true;
      row.append(num, mark);
      gutterInner.appendChild(row);
    }
    while (gutterInner.childElementCount > visible) {
      gutterInner.lastElementChild?.remove();
    }
    for (let i = 0; i < visible; i++) {
      const line = first + i;
      const row = gutterInner.children[i] as HTMLElement;
      row.style.height = `${String(lh)}px`;
      const num = row.firstElementChild;
      if (num) num.textContent = String(line + 1);
      const mark = row.lastElementChild as HTMLElement | null;
      const lineIssues = byLine.get(line + 1);
      const err = Boolean(lineIssues && lineIssues.length > 0);
      row.classList.toggle('studio-gutter-err', err);
      if (mark) {
        mark.hidden = !err;
        mark.title = err && lineIssues ? lineIssues.map((iss) => iss.hint ?? iss.message).join(' · ') : '';
      }
    }
    gutterInner.style.transform = `translateY(${String(first * lh - scroll)}px)`;

    hints.replaceChildren();
    for (const issue of issues) {
      const line = issue.line;
      if (line < first + 1 || line > last) continue;
      const chip = document.createElement('div');
      chip.className = 'studio-hint';
      chip.style.top = `${String((line - 1) * lh - scroll)}px`;
      chip.textContent = issue.hint ?? issue.message;
      hints.appendChild(chip);
    }
  };

  const onInput = (): void => {
    text = textarea.value;
    opts.onChange?.(text);
    paint('hot');
    scheduleIdle();
  };

  const onScroll = (): void => {
    paint('hot');
  };

  const onCaret = (): void => {
    paint(text.length <= TOKEN_HIGHLIGHT_CHAR_BUDGET ? 'full' : 'hot');
  };

  textarea.addEventListener('input', onInput);
  textarea.addEventListener('scroll', onScroll);
  textarea.addEventListener('keyup', onCaret);
  textarea.addEventListener('click', onCaret);
  textarea.addEventListener('select', onCaret);

  paint();

  return {
    root,
    textarea,
    getValue: () => text,
    setValue(next) {
      text = next;
      textarea.value = next;
      paint();
      scheduleIdle();
    },
    setIssues(next) {
      issues = next;
      const invalid = next.length > 0;
      textarea.setAttribute('aria-invalid', invalid ? 'true' : 'false');
      paint();
    },
    getIssues: () => issues,
    setCaret(offset) {
      const clamped = Math.max(0, Math.min(text.length, offset));
      textarea.setSelectionRange(clamped, clamped);
      paint();
    },
    paint,
    dispose() {
      if (idleHandle !== null) timers.clearTimeout(idleHandle);
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('scroll', onScroll);
      textarea.removeEventListener('keyup', onCaret);
      textarea.removeEventListener('click', onCaret);
      textarea.removeEventListener('select', onCaret);
      root.remove();
    },
  };
}
