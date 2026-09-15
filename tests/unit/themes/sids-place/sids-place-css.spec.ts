import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tokenEntries } from '@themes/registry';
import { SIDS_PLACE_TOKENS } from '@themes/sids-place/tokens';

const CSS = readFileSync(join(process.cwd(), 'src/themes/sids-place/sids-place.css'), 'utf8');

function declaredTokens(cssBlock: string): Array<[string, string]> {
  return [...cssBlock.matchAll(/(--gol-[a-z0-9-]+):\s*([^;]+);/g)].map(
    (m) => [m[1] as string, (m[2] as string).trim()] as [string, string],
  );
}

describe('themes/sids-place/sids-place.css — matches tokens.ts exactly (no drift)', () => {
  it('has one declaration per SIDS_PLACE_TOKENS entry, same values', () => {
    const declared = Object.fromEntries(declaredTokens(CSS));
    const expected = Object.fromEntries(tokenEntries(SIDS_PLACE_TOKENS));
    expect(declared).toEqual(expected);
  });

  it('declares light color-scheme', () => {
    expect(CSS).toMatch(/color-scheme:\s*light;/);
  });
});
