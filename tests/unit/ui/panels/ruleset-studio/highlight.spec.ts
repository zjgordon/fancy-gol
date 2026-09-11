import { describe, expect, it } from 'vitest';
import { escapeHtml, highlightRange, matchingBracket, tokenizeJson } from '@ui/panels/ruleset-studio/highlight';

describe('tokenizeJson', () => {
  it('marks object keys separately from string values', () => {
    const tokens = tokenizeJson('{ "born": [3] }').filter((t) => t.kind !== 'space');
    const kinds = tokens.map((t) => t.kind);
    expect(kinds).toEqual(['punct', 'key', 'punct', 'punct', 'number', 'punct', 'punct']);
  });

  it('keeps numbers, literals, and nested arrays', () => {
    const tokens = tokenizeJson('[true, false, null, 1.5e2]').filter((t) => t.kind !== 'space' && t.kind !== 'punct');
    expect(tokens.map((t) => t.kind)).toEqual(['lit', 'lit', 'lit', 'number']);
  });
});

describe('matchingBracket', () => {
  it('pairs the object that wraps a Life-like rule', () => {
    const text = '{ "born": [3, 6] }';
    expect(matchingBracket(text, 0)).toEqual({ open: 0, close: text.length - 1 });
    expect(matchingBracket(text, 10)).toEqual({ open: 10, close: 15 });
  });

  it('ignores brackets inside strings', () => {
    const text = '{ "note": "a { b }" }';
    const match = matchingBracket(text, 0);
    expect(match).toEqual({ open: 0, close: text.length - 1 });
  });

  it('returns null when nothing is under the caret', () => {
    expect(matchingBracket('"hi"', 2)).toBeNull();
  });
});

describe('highlightRange', () => {
  it('emits token classes and escapes markup', () => {
    const html = highlightRange('{ "a": "<x>" }', 0, 14);
    expect(html).toContain('studio-tok-key');
    expect(html).toContain('studio-tok-str');
    expect(html).toContain('&lt;x&gt;');
    expect(html).not.toContain('<x>');
  });

  it('marks a matched pair', () => {
    const html = highlightRange('[1]', 0, 3, { open: 0, close: 2 });
    expect(html).toContain('studio-tok-match');
  });
});

describe('escapeHtml', () => {
  it('escapes the three markup characters', () => {
    expect(escapeHtml('&<>')).toBe('&amp;&lt;&gt;');
  });
});
