import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenEntries } from '@themes/registry';
import { VOID_WALKER_TOKENS } from '@themes/void-walker/tokens';

const CSS = readFileSync(join(process.cwd(), 'src/themes/void-walker/void-walker.css'), 'utf8');

function declaredTokens(cssBlock: string): Array<[string, string]> {
  return [...cssBlock.matchAll(/(--gol-[a-z0-9-]+):\s*([^;]+);/g)].map(
    (m) => [m[1] as string, (m[2] as string).trim()] as [string, string],
  );
}

describe('themes/void-walker/void-walker.css — matches tokens.ts exactly (no drift)', () => {
  it('has one declaration per VOID_WALKER_TOKENS entry, same values', () => {
    const declared = Object.fromEntries(declaredTokens(CSS));
    const expected = Object.fromEntries(tokenEntries(VOID_WALKER_TOKENS));
    expect(declared).toEqual(expected);
  });

  it('declares dark color-scheme', () => {
    expect(CSS).toMatch(/color-scheme:\s*dark;/);
  });
});
