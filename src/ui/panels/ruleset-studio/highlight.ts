/**
 * A ~80-line JSON highlighter and bracket matcher (P2-E-1). Overlay a `<pre>` on a
 * `<textarea>` — a real editor package is a 2 MB no-bloat violation.
 */

export type JsonTokenKind = 'key' | 'string' | 'number' | 'punct' | 'lit' | 'space' | 'other';

export interface JsonToken {
  readonly kind: JsonTokenKind;
  readonly start: number;
  readonly end: number;
}

export interface BracketMatch {
  readonly open: number;
  readonly close: number;
}

const OPENERS: Record<string, string> = { '{': '}', '[': ']' };
const CLOSERS: Record<string, string> = { '}': '{', ']': '[' };

export function tokenizeJson(text: string, from = 0, to = text.length): JsonToken[] {
  const tokens: JsonToken[] = [];
  let i = from;
  const end = Math.min(text.length, to);
  let expectKey = false;
  const stack: Array<'obj' | 'arr'> = [];

  const push = (kind: JsonTokenKind, start: number, stop: number): void => {
    if (stop > start) tokens.push({ kind, start, end: stop });
  };

  while (i < end) {
    const c = text[i]!;
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      const start = i;
      while (i < end) {
        const w = text[i];
        if (w === ' ' || w === '\t' || w === '\n' || w === '\r') i += 1;
        else break;
      }
      push('space', start, i);
      continue;
    }
    if (c === '{' || c === '}' || c === '[' || c === ']' || c === ':' || c === ',') {
      if (c === '{') {
        stack.push('obj');
        expectKey = true;
      } else if (c === '[') {
        stack.push('arr');
        expectKey = false;
      } else if (c === '}' || c === ']') {
        stack.pop();
        expectKey = stack[stack.length - 1] === 'obj';
      } else if (c === ':') {
        expectKey = false;
      } else if (c === ',') {
        expectKey = stack[stack.length - 1] === 'obj';
      }
      push('punct', i, i + 1);
      i += 1;
      continue;
    }
    if (c === '"') {
      const start = i;
      i += 1;
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2;
          continue;
        }
        if (text[i] === '"') {
          i += 1;
          break;
        }
        i += 1;
      }
      const slicedEnd = Math.min(i, end);
      push(expectKey ? 'key' : 'string', start, slicedEnd);
      continue;
    }
    if (c === '-' || (c >= '0' && c <= '9')) {
      const start = i;
      i += 1;
      while (i < end) {
        const d = text[i]!;
        if ((d >= '0' && d <= '9') || d === '.' || d === 'e' || d === 'E' || d === '+' || d === '-') i += 1;
        else break;
      }
      push('number', start, i);
      continue;
    }
    if (c === 't' || c === 'f' || c === 'n') {
      const start = i;
      while (i < end) {
        const ch = text.charCodeAt(i);
        if (ch >= 97 && ch <= 122) i += 1;
        else break;
      }
      push('lit', start, i);
      continue;
    }
    push('other', i, i + 1);
    i += 1;
  }
  return tokens;
}

export function matchingBracket(text: string, caret: number): BracketMatch | null {
  const at = text[caret];
  const before = caret > 0 ? text[caret - 1] : undefined;
  let pos = -1;
  if (at && (OPENERS[at] || CLOSERS[at])) pos = caret;
  else if (before && (OPENERS[before] || CLOSERS[before])) pos = caret - 1;
  if (pos < 0) return null;
  const ch = text[pos]!;
  const openCh = OPENERS[ch];
  if (openCh) {
    const close = scanMatch(text, pos, ch, openCh, 1);
    return close < 0 ? null : { open: pos, close };
  }
  const closeCh = CLOSERS[ch];
  if (closeCh) {
    const open = scanMatch(text, pos, ch, closeCh, -1);
    return open < 0 ? null : { open, close: pos };
  }
  return null;
}

function scanMatch(text: string, from: number, self: string, pair: string, dir: 1 | -1): number {
  let depth = 0;
  let i = from;
  let inString = false;
  while (i >= 0 && i < text.length) {
    const c = text[i]!;
    if (inString) {
      if (c === '\\') {
        i += dir;
        if (i >= 0 && i < text.length) i += dir;
        continue;
      }
      if (c === '"') inString = false;
      i += dir;
      continue;
    }
    if (c === '"') {
      inString = true;
      i += dir;
      continue;
    }
    if (c === self) {
      depth += 1;
    } else if (c === pair) {
      depth -= 1;
      if (depth === 0) return i;
    }
    i += dir;
  }
  return -1;
}

export function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

const TOKEN_CLASS: Record<JsonTokenKind, string | null> = {
  key: 'studio-tok-key',
  string: 'studio-tok-str',
  number: 'studio-tok-num',
  punct: 'studio-tok-punct',
  lit: 'studio-tok-lit',
  space: null,
  other: null,
};

/** Highlight `[from, to)` only — the editor virtualises so a 2,000-line document never paints offscreen. */
export function highlightRange(
  text: string,
  from: number,
  to: number,
  match: BracketMatch | null = null,
): string {
  const tokens = tokenizeJson(text, from, to);
  let html = '';
  let cursor = from;
  const emit = (start: number, end: number, cls: string | null, extra: string | null): void => {
    if (end <= start) return;
    const body = escapeHtml(text.slice(start, end));
    const classes = [cls, extra].filter(Boolean).join(' ');
    html += classes ? `<span class="${classes}">${body}</span>` : body;
  };
  for (const tok of tokens) {
    if (tok.start > cursor) emit(cursor, tok.start, null, null);
    const extra =
      match &&
      ((tok.start <= match.open && match.open < tok.end) || (tok.start <= match.close && match.close < tok.end))
        ? 'studio-tok-match'
        : null;
    emit(tok.start, tok.end, TOKEN_CLASS[tok.kind], extra);
    cursor = tok.end;
  }
  if (cursor < to) emit(cursor, to, null, null);
  return html;
}
