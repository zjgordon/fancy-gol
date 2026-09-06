import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenEntries } from '@themes/registry';
import { DEFAULT_DARK_TOKENS, DEFAULT_LIGHT_TOKENS } from '@themes/default/tokens';

const CSS = readFileSync(join(process.cwd(), 'src/themes/default/default.css'), 'utf8');

/** Every `--gol-<name>: <value>;` declaration in a block of CSS text, as `[name, value]` pairs
 * with the value's own trailing whitespace/semicolon trimmed. */
function declaredTokens(cssBlock: string): Array<[string, string]> {
  return [...cssBlock.matchAll(/(--gol-[a-z0-9-]+):\s*([^;]+);/g)].map(
    (m) => [m[1] as string, (m[2] as string).trim()] as [string, string],
  );
}

// The file is exactly one top-level `:root` block (dark) followed by one
// `@media (prefers-color-scheme: light) { :root { ... } }` block (the light overrides) — split on
// `@media` rather than parsing real CSS, the same "small, hand-written, good enough for one
// specific file" scan `tests/unit/themes/tokens.spec.ts` already uses for `tokens.css`.
const [darkBlock, lightBlock] = CSS.split('@media');

describe('themes/default/default.css — matches tokens.ts exactly (no drift)', () => {
  it('dark (:root) block has one declaration per DEFAULT_DARK_TOKENS entry, same values', () => {
    const declared = Object.fromEntries(declaredTokens(darkBlock as string));
    const expected = Object.fromEntries(tokenEntries(DEFAULT_DARK_TOKENS));
    expect(declared).toEqual(expected);
  });

  it('light (prefers-color-scheme) block has one declaration per DEFAULT_LIGHT_TOKENS colour, same values', () => {
    const declared = Object.fromEntries(declaredTokens(lightBlock as string));
    // The light block only overrides `color`; the rest is inherited from the :root block above.
    const expectedColorOnly = Object.fromEntries(
      tokenEntries(DEFAULT_LIGHT_TOKENS).filter(([name]) => name.startsWith('--gol-color-')),
    );
    expect(declared).toEqual(expectedColorOnly);
  });

  it('the light block declares nothing beyond colour (type/space/radius/shadow/motion are shared)', () => {
    const declaredNames = declaredTokens(lightBlock as string).map(([name]) => name);
    for (const name of declaredNames) {
      expect(name.startsWith('--gol-color-'), name).toBe(true);
    }
  });

  it('color-scheme is declared and matches the variant', () => {
    expect(darkBlock).toMatch(/color-scheme:\s*dark;/);
    expect(lightBlock).toMatch(/color-scheme:\s*light;/);
  });
});
