/**
 * Shared fuzzy scorer (P2-B-3 writes it; P4-A-1 promotes it for the palette).
 * One implementation for library search and later command ranking — do not
 * grow a second matcher beside this file.
 *
 * Subsequence match with gap penalties, bonuses for word-boundary /
 * camelCase-boundary / exact-prefix / acronym hits, and a match-index
 * array for highlighting. Two linear passes (boundary-first, then
 * leftmost) keep 1,000 candidates under a millisecond.
 */

export interface FuzzyHit {
  readonly score: number;
  /** Inclusive indices into the original candidate string. */
  readonly indices: readonly number[];
}

const GAP = 4;
const CONSECUTIVE = 10;
const WORD = 48;
const CAMEL = 36;
const PREFIX = 28;
const ACRONYM = 22;
const BASE = 2;

export function isWordBoundary(text: string, index: number): boolean {
  if (index <= 0) return true;
  const prev = text[index - 1]!;
  return /[\s_\-./:+]/.test(prev);
}

export function isCamelBoundary(text: string, index: number): boolean {
  if (index <= 0) return false;
  const prev = text[index - 1]!;
  const cur = text[index]!;
  return /[a-z]/.test(prev) && /[A-Z]/.test(cur);
}

function isStrongBoundary(text: string, index: number): boolean {
  return isWordBoundary(text, index) || isCamelBoundary(text, index);
}

function foldCode(code: number): number {
  return code >= 65 && code <= 90 ? code + 32 : code;
}

function collect(query: string, candidate: string, boundariesOnly: boolean): number[] | null {
  const indices: number[] = [];
  let qi = 0;
  const qn = query.length;
  const cn = candidate.length;
  for (let ci = 0; ci < cn && qi < qn; ci++) {
    if (foldCode(candidate.charCodeAt(ci)) !== foldCode(query.charCodeAt(qi))) continue;
    if (boundariesOnly && !isStrongBoundary(candidate, ci)) continue;
    indices.push(ci);
    qi += 1;
  }
  return qi === qn ? indices : null;
}

function scorePath(candidate: string, indices: readonly number[]): number {
  let score = 0;
  let allBoundary = true;
  for (let i = 0; i < indices.length; i++) {
    const ci = indices[i]!;
    score += BASE;
    if (isWordBoundary(candidate, ci)) score += WORD;
    else if (isCamelBoundary(candidate, ci)) score += CAMEL;
    else allBoundary = false;
    if (i === 0) {
      if (ci === 0) score += PREFIX;
      score -= GAP * ci;
    } else {
      const gap = ci - indices[i - 1]! - 1;
      score += gap === 0 ? CONSECUTIVE : -GAP * gap;
    }
    if (allBoundary && isStrongBoundary(candidate, ci)) score += ACRONYM;
  }
  if (allBoundary) score += ACRONYM * indices.length;
  return score;
}

/**
 * Best subsequence alignment of `query` inside `candidate`, or `null` when
 * the query is not a subsequence (case-insensitive). An empty/whitespace
 * query is a zero-score hit with no indices — callers that want "show
 * everything" short-circuit before scoring.
 */
export function scoreFuzzy(query: string, candidate: string): FuzzyHit | null {
  const q = query.trim();
  if (q.length === 0) return { score: 0, indices: [] };
  if (candidate.length === 0) return null;

  const boundary = collect(q, candidate, true);
  if (boundary) return { score: scorePath(candidate, boundary), indices: boundary };
  const left = collect(q, candidate, false);
  if (!left) return null;
  return { score: scorePath(candidate, left), indices: left };
}

export interface RankedFuzzy<T> {
  readonly item: T;
  readonly score: number;
  readonly field: string;
  readonly indices: readonly number[];
}

/** Rank `items` by the best fuzzy hit across the strings `fields` returns. */
export function rankFuzzy<T>(
  query: string,
  items: readonly T[],
  fields: (item: T) => readonly string[],
): RankedFuzzy<T>[] {
  const q = query.trim();
  const out: RankedFuzzy<T>[] = [];
  for (const item of items) {
    if (q.length === 0) {
      out.push({ item, score: 0, field: fields(item)[0] ?? '', indices: [] });
      continue;
    }
    let best: RankedFuzzy<T> | null = null;
    for (const field of fields(item)) {
      if (!field) continue;
      const hit = scoreFuzzy(q, field);
      if (!hit) continue;
      if (!best || hit.score > best.score) {
        best = { item, score: hit.score, field, indices: hit.indices };
      }
    }
    if (best) out.push(best);
  }
  out.sort((a, b) => b.score - a.score || a.field.localeCompare(b.field));
  return out;
}
