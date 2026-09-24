/**
 * P3-D-3 — Theme accessibility audit.
 *
 * 1. WCAG AA on every chrome token pair derived from the `ColorTokens` contract.
 * 2. axe-core zero violations on the live shell under each theme.
 * 3. Cell palettes stay distinguishable under protanopia and deuteranopia for
 *    every builtin ruleset (or the theme documents a high-contrast variant —
 *    none of the six currently need one).
 */
import { createRequire } from 'node:module';
import { expect, test } from '@playwright/test';
import { BUILTIN_RULESETS } from '@engine/rules/builtin';
import {
  colorDistance,
  parseCssColor,
  simulateColorBlindness,
  type ColorBlindnessKind,
  type RGB,
} from '@shared/color';
import { CHIBA_CITY_THEME } from '@themes/chiba-city/theme';
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from '@themes/default/theme';
import { FLATLINE_THEME } from '@themes/flatline/theme';
import { SIDS_PLACE_THEME } from '@themes/sids-place/theme';
import { SYNTHWAVE_THEME } from '@themes/synthwave/theme';
import type { ThemeModule } from '@themes/types';
import { VOID_WALKER_THEME } from '@themes/void-walker/theme';
import { gotoApp, runCommand } from '../e2e/helpers';
import { assertPairMeetsAa, deriveChromeContrastPairs } from './token-pairs';

const require = createRequire(import.meta.url);
const AXE_PATH = require.resolve('axe-core/axe.min.js');

/** Same floor the per-theme palette specs use — a documented approximation. */
const MIN_CVD_DISTANCE = 50;
const CVD_KINDS: readonly ColorBlindnessKind[] = ['protanopia', 'deuteranopia'];
/** Age past every theme's ramp so we sample the steady colour. */
const STEADY_AGE = 10_000;

interface AxeResults {
  readonly violations: readonly { readonly id: string; readonly help: string }[];
}

interface AxeWindow {
  axe: {
    run: (
      context: Element,
      options: { rules: Record<string, { enabled: boolean }> },
    ) => Promise<AxeResults>;
  };
}

/** Concrete modules a picker/registry can activate (Default light + dark both audited). */
const THEME_MODULES: readonly { readonly id: string; readonly module: ThemeModule }[] = [
  { id: 'default-dark', module: DEFAULT_DARK_THEME },
  { id: 'default-light', module: DEFAULT_LIGHT_THEME },
  { id: 'chiba-city', module: CHIBA_CITY_THEME },
  { id: 'flatline', module: FLATLINE_THEME },
  { id: 'sids-place', module: SIDS_PLACE_THEME },
  { id: 'void-walker', module: VOID_WALKER_THEME },
  { id: 'synthwave', module: SYNTHWAVE_THEME },
];

/** Registration ids the live app activates (adaptive Default → dark under this suite's colorScheme). */
const LIVE_THEME_IDS = [
  'default',
  'chiba-city',
  'flatline',
  'sids-place',
  'void-walker',
  'synthwave',
] as const;

function steadyRgb(theme: ThemeModule, stateId: number): RGB {
  const hex = theme.palette(stateId, STEADY_AGE);
  const rgb = parseCssColor(hex);
  if (!rgb) throw new Error(`${theme.id}: palette(${stateId}) is not a colour: ${hex}`);
  return rgb;
}

function minPairDistance(colors: readonly RGB[]): number {
  let min = Infinity;
  for (let i = 0; i < colors.length; i++) {
    for (let j = i + 1; j < colors.length; j++) {
      min = Math.min(min, colorDistance(colors[i]!, colors[j]!));
    }
  }
  return min;
}

test.describe('P3-D-3 token contrast (derived pairs)', () => {
  for (const { id, module } of THEME_MODULES) {
    test(`${id}: every derived chrome pair clears WCAG AA`, () => {
      const pairs = deriveChromeContrastPairs(module.tokens.color);
      expect(pairs.length).toBeGreaterThan(10);
      for (const pair of pairs) {
        expect(() => assertPairMeetsAa(pair), pair.label).not.toThrow();
      }
    });
  }
});

test.describe('P3-D-3 cell palettes under CVD simulation', () => {
  for (const { id, module } of THEME_MODULES) {
    for (const kind of CVD_KINDS) {
      test(`${id}: every builtin ruleset stays distinguishable under ${kind}`, () => {
        for (const ruleset of BUILTIN_RULESETS) {
          const liveIds = ruleset.states.map((s) => s.id).filter((sid) => sid !== 0);
          if (liveIds.length < 2) continue;

          const simulated = liveIds.map((sid) => simulateColorBlindness(steadyRgb(module, sid), kind));

          // Generations trails (Bloomerang et al.) intentionally fade — adjacent steps are close.
          // Require the CVD floor on the primary live hues (ids 1–8 present in the ruleset);
          // the full set must only stay non-identical under the simulation.
          const primaryIds = liveIds.filter((sid) => sid >= 1 && sid <= 8);
          if (primaryIds.length >= 2) {
            const primarySim = primaryIds.map((sid) =>
              simulateColorBlindness(steadyRgb(module, sid), kind),
            );
            const primaryMin = minPairDistance(primarySim);
            expect(
              primaryMin,
              `${id} / ${ruleset.id} / ${kind}: primary min distance ${primaryMin.toFixed(1)}`,
            ).toBeGreaterThanOrEqual(MIN_CVD_DISTANCE);
          }

          const allMin = minPairDistance(simulated);
          expect(
            allMin,
            `${id} / ${ruleset.id} / ${kind}: trail collapsed (min ${allMin.toFixed(1)})`,
          ).toBeGreaterThan(0);
        }
      });
    }
  }
});

test.describe('P3-D-3 axe-core on the live shell', () => {
  test.use({ colorScheme: 'dark' });

  for (const themeId of LIVE_THEME_IDS) {
    test(`shell under ${themeId} has zero axe violations`, async ({ page }) => {
      await page.addInitScript((id) => {
        try {
          localStorage.setItem('gol.theme', id);
          localStorage.removeItem('gol.session');
        } catch {
          // private-mode
        }
      }, themeId);
      await gotoApp(page);
      await page.waitForFunction((id) => window.__fancyGol?.themeId === id, themeId, {
        timeout: 10_000,
      });
      // Belt: activate again if boot fell back.
      const current = await page.evaluate(() => window.__fancyGol?.themeId);
      if (current !== themeId) {
        await runCommand(page, `theme.select.${themeId}`);
        await page.waitForFunction((id) => window.__fancyGol?.themeId === id, themeId);
      }

      await expect(page.locator('#chrome-toolbar')).toBeVisible();
      await page.addScriptTag({ path: AXE_PATH });

      const results = await page.evaluate(async () => {
        const { axe } = window as unknown as AxeWindow;
        const root = document.getElementById('chrome') ?? document.body;
        return axe.run(root, {
          // Canvas / HUD paint contrast is the token-pair suite above, not axe's pixel sampler.
          rules: { 'color-contrast': { enabled: false } },
        });
      });

      expect(results.violations, JSON.stringify(results.violations, null, 2)).toEqual([]);
    });
  }
});
