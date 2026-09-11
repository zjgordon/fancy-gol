/**
 * Syntactic RLE codec (P2-A-1 decoder, P2-A-2 canonical encoder). Parse and emit Life/Golly
 * run-length encoding as coordinates and raw state numbers — no ruleset objects, no state
 * alphabets, no engine types.
 *
 * Golly's multi-state tags (Help → RLE):
 *   0: `.` or `b`     1: `A` or `o`     2–24: `B`–`X`
 *   25+: `pA`…`pX`, `qA`…, up through `yO` (state 255).
 *
 * Two-state output uses `b`/`o`; multi-state (any live cell ≥ 2) uses `.`/`A`–`X`/`pA`… so a
 * Golly paste reads the same grid. Encoder output is canonical: live bbox, counted `$` skips,
 * `#N`/`#O`/`#C` when metadata is present, `rule =` when known, body wrapped at {@link RLE_WRAP}.
 *
 * `#C` / `#c` lines (including SPDX provenance) are opaque comments. An unknown `rule =`
 * string is returned as text for the caller to resolve — never rejected here.
 */
export interface RleCell {
  readonly x: number;
  readonly y: number;
  /** Raw cell state. `0` is dead; interpretation of 1..N is the caller's. */
  readonly state: number;
}

export interface RlePattern {
  readonly width: number;
  readonly height: number;
  readonly cells: readonly RleCell[];
  /** Opaque `rule =` / `#r` string when present. */
  readonly rule?: string;
  readonly name?: string;
  readonly author?: string;
  readonly comments: readonly string[];
  readonly offsetX?: number;
  readonly offsetY?: number;
}

export class PatternParseError extends Error {
  readonly line: number;
  readonly column: number;
  readonly hint: string;

  constructor(message: string, line: number, column: number, hint: string) {
    super(message);
    this.name = 'PatternParseError';
    this.line = line;
    this.column = column;
    this.hint = hint;
  }
}

const MAX_STATE = 255;

/** Golly wraps RLE data at ~70 columns so patterns stay pasteable in mail and text files. */
export const RLE_WRAP = 70;

export interface EncodeOptions {
  /**
   * Trim to the live-cell bounding box (P2-A-2 canonical). Default `true`.
   * Clipboard paste passes `false` so a marquee's dead padding survives the round-trip.
   */
  readonly trim?: boolean;
  /** Column budget for body and `#C` lines. Default {@link RLE_WRAP}. `0` disables wrapping. */
  readonly wrap?: number;
}

export function encode(
  pattern: Omit<RlePattern, 'comments'> & { readonly comments?: readonly string[] },
  options?: EncodeOptions,
): string {
  const trim = options?.trim ?? true;
  const wrap = options?.wrap ?? RLE_WRAP;

  let multi = false;
  for (const cell of pattern.cells) {
    if (cell.state === 0) continue;
    if (cell.state < 0 || cell.state > MAX_STATE) {
      throw new RangeError(`state ${cell.state} is outside RLE's supported range (0-${MAX_STATE})`);
    }
    if (cell.x < 0 || cell.y < 0 || cell.x >= pattern.width || cell.y >= pattern.height) {
      throw new RangeError(`cell (${cell.x},${cell.y}) is outside ${pattern.width}×${pattern.height}`);
    }
    if (cell.state >= 2) multi = true;
  }

  let x0 = 0;
  let y0 = 0;
  let width = pattern.width;
  let height = pattern.height;
  if (trim) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const cell of pattern.cells) {
      if (cell.state === 0) continue;
      if (cell.x < minX) minX = cell.x;
      if (cell.y < minY) minY = cell.y;
      if (cell.x > maxX) maxX = cell.x;
      if (cell.y > maxY) maxY = cell.y;
    }
    if (Number.isFinite(minX)) {
      x0 = minX;
      y0 = minY;
      width = maxX - minX + 1;
      height = maxY - minY + 1;
    }
  }

  const dense = new Uint8Array(Math.max(0, width * height));
  for (const cell of pattern.cells) {
    if (cell.state === 0) continue;
    dense[(cell.y - y0) * width + (cell.x - x0)] = cell.state;
  }

  const lines: string[] = [];
  if (pattern.name !== undefined) lines.push(`#N ${pattern.name}`);
  if (pattern.author !== undefined) lines.push(`#O ${pattern.author}`);
  for (const c of pattern.comments ?? []) {
    lines.push(...wrapPrefixed('#C ', c, wrap));
  }
  if (pattern.offsetX !== undefined || pattern.offsetY !== undefined) {
    lines.push(`#P ${(pattern.offsetX ?? 0) + x0} ${(pattern.offsetY ?? 0) + y0}`);
  }

  const header = `x = ${width}, y = ${height}`;
  if (pattern.rule !== undefined) {
    const withRule = `${header}, rule = ${pattern.rule}`;
    if (wrap > 0 && withRule.length > wrap) {
      lines.push(`#r ${pattern.rule}`);
      lines.push(header);
    } else {
      lines.push(withRule);
    }
  } else {
    lines.push(header);
  }

  const tokens = encodeBodyTokens(dense, width, height, multi);
  lines.push(...wrapTokens(tokens, wrap));
  return lines.join('\n');
}

export function decode(text: string): RlePattern {
  const p = new Parser(text);
  return p.parse();
}

/** @deprecated Prefer {@link encode}; kept so clipboard/session call sites can switch without renaming. */
export const encodeRLE = encode;
/** @deprecated Prefer {@link decode}. */
export const decodeRLE = decode;

function tagForState(state: number, multi: boolean): string {
  if (state === 0) return multi ? '.' : 'b';
  if (state === 1) return multi ? 'A' : 'o';
  if (state >= 2 && state <= 24) return String.fromCharCode(64 + state); // B=2 … X=24
  if (state >= 25 && state <= MAX_STATE) {
    const idx = state - 1;
    const prefix = Math.floor(idx / 24);
    const letter = idx % 24;
    return String.fromCharCode('p'.charCodeAt(0) + prefix - 1) + String.fromCharCode(65 + letter);
  }
  throw new RangeError(`state ${state} is outside RLE's supported range (0-${MAX_STATE})`);
}

function rowIsEmpty(dense: Uint8Array, width: number, y: number): boolean {
  const off = y * width;
  for (let x = 0; x < width; x++) if (dense[off + x] !== 0) return false;
  return true;
}

function emitRow(dense: Uint8Array, width: number, y: number, multi: boolean, tokens: string[]): void {
  const rowOff = y * width;
  let lastLive = -1;
  for (let x = width - 1; x >= 0; x--) {
    if (dense[rowOff + x] !== 0) {
      lastLive = x;
      break;
    }
  }
  let x = 0;
  while (x <= lastLive) {
    const state = dense[rowOff + x]!;
    let j = x + 1;
    while (j <= lastLive && dense[rowOff + j] === state) j++;
    const count = j - x;
    tokens.push((count > 1 ? String(count) : '') + tagForState(state, multi));
    x = j;
  }
}

function dollarToken(n: number): string {
  return n === 1 ? '$' : `${n}$`;
}

function encodeBodyTokens(dense: Uint8Array, width: number, height: number, multi: boolean): string[] {
  const tokens: string[] = [];
  if (height <= 0 || width <= 0) {
    tokens.push('!');
    return tokens;
  }
  let y = 0;
  while (y < height && rowIsEmpty(dense, width, y)) y++;
  if (y === height) {
    tokens.push('!');
    return tokens;
  }
  if (y > 0) tokens.push(dollarToken(y));
  while (y < height) {
    emitRow(dense, width, y, multi, tokens);
    let next = y + 1;
    while (next < height && rowIsEmpty(dense, width, next)) next++;
    if (next >= height) break;
    tokens.push(dollarToken(next - y));
    y = next;
  }
  tokens.push('!');
  return tokens;
}

function wrapTokens(tokens: readonly string[], limit: number): string[] {
  if (limit <= 0) return [tokens.join('')];
  const lines: string[] = [];
  let line = '';
  for (const token of tokens) {
    if (line.length > 0 && line.length + token.length > limit) {
      lines.push(line);
      line = token;
    } else {
      line += token;
    }
  }
  if (line.length > 0) lines.push(line);
  return lines;
}

function wrapPrefixed(prefix: string, text: string, limit: number): string[] {
  if (limit <= 0 || prefix.length + text.length <= limit) return [prefix + text];
  const budget = Math.max(1, limit - prefix.length);
  const lines: string[] = [];
  let rest = text;
  while (rest.length > budget) {
    let cut = rest.lastIndexOf(' ', budget);
    if (cut <= 0) cut = budget;
    lines.push(prefix + rest.slice(0, cut).trimEnd());
    rest = rest.slice(cut).trimStart();
  }
  if (rest.length > 0) lines.push(prefix + rest);
  return lines;
}

function stateForLetter(ch: string): number {
  return ch.charCodeAt(0) - 64; // A=1 … X=24
}

class Parser {
  private readonly src: string;
  private i = 0;
  private line = 1;
  private column = 1;
  private name?: string;
  private author?: string;
  private readonly comments: string[] = [];
  private offsetX?: number;
  private offsetY?: number;
  private hashRule?: string;
  private width = 0;
  private height = 0;
  private headerRule?: string;
  private sawHeader = false;

  constructor(src: string) {
    this.src = src;
  }

  parse(): RlePattern {
    if (this.src.length === 0) {
      throw this.err('empty RLE input', 'a pattern needs an `x = W, y = H` header and a body ending in `!`');
    }
    while (!this.eof()) {
      this.skipBlankLines();
      if (this.eof()) break;
      if (this.peek() === '#') {
        this.readCommentLine();
        continue;
      }
      if (!this.sawHeader) {
        this.readHeader();
        continue;
      }
      break;
    }
    if (!this.sawHeader) {
      throw this.err('missing RLE header', 'expected a line starting with `x =` before the pattern body');
    }
    const cells = this.readBody();
    return {
      width: this.width,
      height: this.height,
      cells,
      comments: this.comments,
      ...(this.name !== undefined ? { name: this.name } : {}),
      ...(this.author !== undefined ? { author: this.author } : {}),
      ...(this.headerRule !== undefined || this.hashRule !== undefined
        ? { rule: this.headerRule ?? this.hashRule }
        : {}),
      ...(this.offsetX !== undefined ? { offsetX: this.offsetX } : {}),
      ...(this.offsetY !== undefined ? { offsetY: this.offsetY } : {}),
    };
  }

  private readCommentLine(): void {
    const startCol = this.column;
    this.advance(); // #
    if (this.eof() || this.peek() === '\n') {
      this.expectNewline();
      return;
    }
    const tag = this.peek();
    this.advance();
    if (tag === 'N' && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
      this.name = this.readRestOfLine();
      return;
    }
    if (tag === 'O' && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
      this.author = this.readRestOfLine();
      return;
    }
    if ((tag === 'C' || tag === 'c') && (this.peek() === ' ' || this.peek() === '\t' || this.peek() === '\n' || this.eof())) {
      if (this.peek() === ' ' || this.peek() === '\t') this.advance();
      this.comments.push(this.readRestOfLine());
      return;
    }
    if ((tag === 'P' || tag === 'R') && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
      const rest = this.readRestOfLine();
      const m = /^\s*(-?\d+)\s+(-?\d+)\s*$/.exec(rest);
      if (!m) {
        throw new PatternParseError(
          `invalid #${tag} offset`,
          this.line - 1,
          startCol,
          'expected `#P x y` or `#R x y` with two integers',
        );
      }
      this.offsetX = Number(m[1]);
      this.offsetY = Number(m[2]);
      return;
    }
    if (tag === 'r' && (this.peek() === ' ' || this.peek() === '\t')) {
      this.advance();
      this.hashRule = this.readRestOfLine();
      return;
    }
    this.readRestOfLine();
  }

  private readHeader(): void {
    const startLine = this.line;
    const startCol = this.column;
    const header = this.readRestOfLine();
    const xy = /^\s*x\s*=\s*(\d+)\s*,\s*y\s*=\s*(\d+)/.exec(header);
    if (!xy) {
      throw new PatternParseError(
        `invalid RLE header: "${header}"`,
        startLine,
        startCol,
        'expected `x = <width>, y = <height>` (optional `, rule = …`)',
      );
    }
    this.width = Number(xy[1]);
    this.height = Number(xy[2]);
    const rule = /(?:^|,)\s*rule\s*=\s*(.+)$/i.exec(header.slice(xy[0].length));
    if (rule) {
      this.headerRule = rule[1]!.trim().replace(/^"|"$/g, '');
    }
    this.sawHeader = true;
  }

  private readBody(): RleCell[] {
    const cells: RleCell[] = [];
    let x = 0;
    let y = 0;
    let countBuf = '';

    const flushCount = (): number => {
      if (countBuf.length === 0) return 1;
      const n = Number(countBuf);
      countBuf = '';
      if (!Number.isFinite(n) || n < 1) {
        throw this.err('invalid run count', 'run lengths must be positive integers');
      }
      return n;
    };

    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r' || ch === '\n') {
        this.advance();
        continue;
      }
      if (ch >= '0' && ch <= '9') {
        countBuf += ch;
        this.advance();
        continue;
      }
      if (countBuf.length > 0 && this.eof()) {
        throw this.err('unterminated run count', 'a number must be followed by a tag (`o`, `b`, `$`, …)');
      }
      const n = flushCount();
      if (ch === '$') {
        this.advance();
        y += n;
        x = 0;
        continue;
      }
      if (ch === '!') {
        this.advance();
        return cells;
      }
      const state = this.readStateTag();
      if (state !== 0) {
        for (let k = 0; k < n; k++) cells.push({ x: x + k, y, state });
      }
      x += n;
    }
    if (countBuf.length > 0) {
      throw this.err('unterminated run count', 'a number must be followed by a tag (`o`, `b`, `$`, …)');
    }
    return cells;
  }

  private readStateTag(): number {
    const ch = this.peek();
    if (ch === 'b' || ch === '.') {
      this.advance();
      return 0;
    }
    if (ch === 'o') {
      this.advance();
      return 1;
    }
    if (ch >= 'A' && ch <= 'X') {
      this.advance();
      return stateForLetter(ch);
    }
    if (ch >= 'p' && ch <= 'y') {
      const prefix = ch;
      this.advance();
      if (this.eof() || this.peek() < 'A' || this.peek() > 'X') {
        throw this.err(
          `incomplete extended state tag "${prefix}"`,
          'Golly extended states are a prefix `p`–`y` plus a letter `A`–`X` (e.g. `pA` = state 25)',
        );
      }
      const letter = this.peek();
      this.advance();
      const prefixIdx = prefix.charCodeAt(0) - 'p'.charCodeAt(0) + 1;
      const state = prefixIdx * 24 + stateForLetter(letter);
      if (state > MAX_STATE) {
        throw this.err(
          `state ${state} exceeds 255`,
          'cell states are stored as bytes; use a tag at most `yO`',
        );
      }
      return state;
    }
    throw this.err(
      `unexpected character ${JSON.stringify(ch)} in RLE body`,
      'tags are `b`/`.` (dead), `o`/`A` (state 1), `B`–`X` (2–24), or `pA`… for states 25+',
    );
  }

  private readRestOfLine(): string {
    let out = '';
    while (!this.eof() && this.peek() !== '\n') {
      if (this.peek() !== '\r') out += this.peek();
      this.advance();
    }
    this.expectNewline();
    return out;
  }

  private skipBlankLines(): void {
    while (!this.eof()) {
      const ch = this.peek();
      if (ch === ' ' || ch === '\t' || ch === '\r') {
        this.advance();
        continue;
      }
      if (ch === '\n') {
        this.advance();
        continue;
      }
      break;
    }
  }

  private expectNewline(): void {
    if (this.eof()) return;
    if (this.peek() === '\r') this.advance();
    if (!this.eof() && this.peek() === '\n') this.advance();
  }

  private peek(): string {
    return this.src[this.i] ?? '';
  }

  private eof(): boolean {
    return this.i >= this.src.length;
  }

  private advance(): void {
    if (this.eof()) return;
    if (this.src[this.i] === '\n') {
      this.line += 1;
      this.column = 1;
    } else {
      this.column += 1;
    }
    this.i += 1;
  }

  private err(message: string, hint: string): PatternParseError {
    return new PatternParseError(message, this.line, this.column, hint);
  }
}
