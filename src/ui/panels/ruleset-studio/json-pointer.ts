/**
 * JSON-pointer → source location (P2-E-1). The engine's validator already speaks RFC 6901
 * paths (`/transition/born/0`); the studio only needs to know which editor line that is.
 * A tiny recursive-descent walk — no `jsonc-parser`, no sourcemaps.
 */

export interface SourceLocation {
  readonly offset: number;
  readonly line: number;
  readonly column: number;
}

export function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) starts.push(i + 1);
  }
  return starts;
}

export function offsetToLineCol(starts: readonly number[], offset: number): { line: number; column: number } {
  let lo = 0;
  let hi = starts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if ((starts[mid] ?? 0) <= offset) lo = mid;
    else hi = mid - 1;
  }
  return { line: lo + 1, column: offset - (starts[lo] ?? 0) + 1 };
}

export function escapePointerToken(key: string): string {
  return key.replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Index every JSON pointer in `text` to the start of its value. Invalid JSON yields
 * whatever prefix the walk managed — callers fall back to a syntax-error line.
 */
export function indexJsonPointers(text: string): Map<string, SourceLocation> {
  const map = new Map<string, SourceLocation>();
  const starts = lineStarts(text);
  let i = 0;
  const n = text.length;

  const skipWs = (): void => {
    while (i < n) {
      const c = text.charCodeAt(i);
      if (c === 32 || c === 9 || c === 10 || c === 13) i += 1;
      else break;
    }
  };

  const record = (pointer: string): void => {
    const loc = offsetToLineCol(starts, i);
    map.set(pointer, { offset: i, line: loc.line, column: loc.column });
  };

  const parseString = (): boolean => {
    if (text[i] !== '"') return false;
    i += 1;
    while (i < n) {
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '"') {
        i += 1;
        return true;
      }
      i += 1;
    }
    return false;
  };

  const parseObject = (pointer: string): boolean => {
    i += 1;
    skipWs();
    if (text[i] === '}') {
      i += 1;
      return true;
    }
    while (i < n) {
      skipWs();
      const keyStart = i;
      if (!parseString()) return false;
      let key: string;
      try {
        key = JSON.parse(text.slice(keyStart, i)) as string;
      } catch {
        return false;
      }
      skipWs();
      if (text[i] !== ':') return false;
      i += 1;
      if (!parseValue(`${pointer}/${escapePointerToken(key)}`)) return false;
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === '}') {
        i += 1;
        return true;
      }
      return false;
    }
    return false;
  };

  const parseArray = (pointer: string): boolean => {
    i += 1;
    skipWs();
    if (text[i] === ']') {
      i += 1;
      return true;
    }
    let idx = 0;
    while (i < n) {
      if (!parseValue(`${pointer}/${idx}`)) return false;
      idx += 1;
      skipWs();
      if (text[i] === ',') {
        i += 1;
        continue;
      }
      if (text[i] === ']') {
        i += 1;
        return true;
      }
      return false;
    }
    return false;
  };

  const parseValue = (pointer: string): boolean => {
    skipWs();
    if (i >= n) return false;
    record(pointer);
    const c = text[i];
    if (c === '{') return parseObject(pointer);
    if (c === '[') return parseArray(pointer);
    if (c === '"') return parseString();
    if (c === 't' || c === 'f' || c === 'n') {
      while (i < n) {
        const ch = text.charCodeAt(i);
        if (ch >= 97 && ch <= 122) i += 1;
        else break;
      }
      return true;
    }
    if (c === '-' || (c !== undefined && c >= '0' && c <= '9')) {
      while (i < n) {
        const ch = text[i]!;
        if ((ch >= '0' && ch <= '9') || ch === '.' || ch === 'e' || ch === 'E' || ch === '+' || ch === '-') {
          i += 1;
        } else break;
      }
      return true;
    }
    return false;
  };

  skipWs();
  parseValue('');
  return map;
}

export function locatePointer(text: string, pointer: string): SourceLocation | null {
  const index = indexJsonPointers(text);
  if (index.has(pointer)) return index.get(pointer) ?? null;
  // Walk parents so `/transition/born/0` still lands near `/transition/born` if the walk
  // stopped early (trailing comma, half-typed value).
  let cur = pointer;
  while (cur.length > 0) {
    const slash = cur.lastIndexOf('/');
    cur = slash <= 0 ? '' : cur.slice(0, slash);
    if (index.has(cur)) return index.get(cur) ?? null;
  }
  return index.get('') ?? null;
}

/** Best-effort line for `JSON.parse` failures (V8 `position N` / SpiderMonkey `line N column M`). */
export function syntaxErrorLocation(text: string, error: unknown): SourceLocation {
  const message = error instanceof Error ? error.message : String(error);
  const pos = /position (\d+)/i.exec(message);
  if (pos) {
    const offset = Math.min(text.length, Math.max(0, Number(pos[1])));
    const loc = offsetToLineCol(lineStarts(text), offset);
    return { offset, line: loc.line, column: loc.column };
  }
  const lc = /line (\d+) column (\d+)/i.exec(message);
  if (lc) {
    const line = Number(lc[1]);
    const column = Number(lc[2]);
    const starts = lineStarts(text);
    const start = starts[line - 1] ?? 0;
    return { offset: start + Math.max(0, column - 1), line, column };
  }
  return { offset: 0, line: 1, column: 1 };
}
