/**
 * P3-E-2 — ADR-012 D3: "never present an approximation as exact".
 *
 * Any pass that draws a stand-in carries an `approximation` string. This ties each one to the
 * theme README that uses it, verbatim, so the label cannot be dropped from either side.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { THEME_IDS, createThemePassStack } from '@render/effects/library';
import { stubOffscreenCanvas } from '../render/recording-canvas';

beforeAll(stubOffscreenCanvas);
afterAll(() => vi.unstubAllGlobals());

describe('labelled approximations (ADR-012 D3)', () => {
  it.each(THEME_IDS)('%s: every approximating pass is named in its README, verbatim', (id) => {
    const stack = createThemePassStack(id);
    const readme = readFileSync(join(process.cwd(), 'src/themes', id, 'README.md'), 'utf8');
    const labelled = stack.filter((p) => p.approximation);
    for (const pass of labelled) {
      expect(readme, `${id} README must quote the ${pass.id} approximation`).toContain(pass.approximation!);
    }
    if (labelled.length > 0) expect(readme).toMatch(/^## Approximations$/m);
    for (const pass of stack) pass.dispose();
  });

  it('exactly the passes that cannot be drawn exactly are labelled', () => {
    const labelled = new Set<string>();
    for (const id of THEME_IDS) {
      for (const pass of createThemePassStack(id)) {
        if (pass.approximation) labelled.add(pass.id);
        pass.dispose();
      }
    }
    expect([...labelled].sort()).toEqual(['chromaticAberration', 'crtCurvature']);
  });
});
