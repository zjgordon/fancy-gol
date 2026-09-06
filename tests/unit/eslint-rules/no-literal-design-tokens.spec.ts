import { describe, expect, it } from 'vitest';
import { Linter } from 'eslint';
import {
  findLiteralViolation,
  noLiteralDesignTokens,
} from '../../../scripts/eslint-rules/no-literal-design-tokens.mjs';

function lint(code: string) {
  const linter = new Linter();
  return linter.verify(code, {
    plugins: { local: { rules: { 'no-literal-design-tokens': noLiteralDesignTokens } } },
    rules: { 'local/no-literal-design-tokens': 'error' },
  });
}

describe('findLiteralViolation (pure)', () => {
  it('flags a 3, 4, 6 and 8 digit hex colour', () => {
    expect(findLiteralViolation('#333')).toMatch(/hex colour/);
    expect(findLiteralViolation('#3338')).toMatch(/hex colour/);
    expect(findLiteralViolation('#334455')).toMatch(/hex colour/);
    expect(findLiteralViolation('#33445566')).toMatch(/hex colour/);
  });

  it('flags rgb()/rgba()/hsl()/hsla() written as a literal string', () => {
    expect(findLiteralViolation('rgb(1, 2, 3)')).toMatch(/rgb\(\)\/hsl\(\)/);
    expect(findLiteralViolation('rgba(1, 2, 3, 0.5)')).toMatch(/rgb\(\)\/hsl\(\)/);
    expect(findLiteralViolation('hsl(200, 50%, 50%)')).toMatch(/rgb\(\)\/hsl\(\)/);
  });

  it('flags a bare number+unit duration or size', () => {
    expect(findLiteralViolation('150ms')).toMatch(/duration\/size/);
    expect(findLiteralViolation('16px')).toMatch(/duration\/size/);
    expect(findLiteralViolation('0.5px')).toMatch(/duration\/size/);
  });

  it('does not flag a font spec that merely contains a px value', () => {
    // `ui/overlay/grid-lines.ts`'s DEFAULT_FONT — a legitimate Canvas2D font string, not a raw
    // size literal, because a `<canvas>` context cannot resolve `var(--gol-*)`.
    expect(findLiteralViolation('12px monospace')).toBeNull();
  });

  it('does not flag ordinary strings or non-strings', () => {
    expect(findLiteralViolation('hello world')).toBeNull();
    expect(findLiteralViolation(150)).toBeNull();
    expect(findLiteralViolation(true)).toBeNull();
  });
});

describe('no-literal-design-tokens (ESLint rule)', () => {
  it('catches a deliberately introduced literal hex colour in a component', () => {
    const messages = lint("el.style.color = '#333';");
    expect(messages).toHaveLength(1);
    expect(messages[0]?.ruleId).toBe('local/no-literal-design-tokens');
  });

  it('catches a literal rgb()/hsl() string', () => {
    expect(lint("el.style.background = 'rgb(51, 51, 51)';")).toHaveLength(1);
  });

  it('catches a raw ms/px duration written as a no-substitution template literal', () => {
    expect(lint('el.style.transitionDuration = `150ms`;')).toHaveLength(1);
  });

  it('allows a colour string built at runtime from theme-supplied components', () => {
    // The exact pattern `ui/overlay/grid-lines.ts` and `ui/overlay/selection.ts` already use:
    // interpolation makes this a resolved value, not a literal.
    const code = 'function rgba(r, g, b, a) { return `rgba(${r}, ${g}, ${b}, ${a})`; }';
    expect(lint(code)).toHaveLength(0);
  });

  it('allows reading a --gol-* custom property', () => {
    expect(lint("el.style.setProperty('color', 'var(--gol-color-accent)');")).toHaveLength(0);
  });

  it('allows an ordinary string literal', () => {
    expect(lint("const title = 'Play / Pause';")).toHaveLength(0);
  });
});
