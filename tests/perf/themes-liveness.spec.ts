/**
 * P3-E-1 — `browser-floor`: the blocking CI tier of the two-tier theme frame gate
 * (planning/README.md §3.6, decision D6; contract in ADR-012 rule 3).
 *
 * Three checks per theme, all against the real app in real Chromium:
 *
 *  1. **Effect liveness** — every stage a theme enables must change pixels. P3-D-4's review found
 *     quality 3 byte-identical to quality 2 in four themes: the post stage cost 40–110 ms a frame
 *     and painted nothing, because `readSourcePixels` returns zeros on a real `OffscreenCanvas`.
 *     Every unit test passed, because they ran on `SoftwareSurface`.
 *  2. **Allocation** — the heap's peak-to-trough span over 300 frames. Chromium-only and a proxy
 *     for per-frame allocation, not a byte count; ADR-012 rule 1 forbids per-frame buffers.
 *  3. **Same-runner ratio** — median frame at quality 3 ÷ median frame of Default, same page, same
 *     runner. A ratio, so a slow CI box does not make a theme look worse than it is.
 *
 * **Red-first without a red branch.** Cases that are broken today carry `test.fail()` naming the
 * task that owns the fix. Such a case *passes* while it is broken and *fails* the run the moment it
 * works, which forces the owning task to delete its marker — a fixed defect cannot stay silently
 * "expected to fail". Removing a marker is how a task proves it is done.
 */
import { expect, test } from '@playwright/test';
import {
  THEME_IDS,
  activateTheme,
  diffPixels,
  heapSpanBytes,
  medianFrameMs,
  openApp,
  pauseSim,
  snapAtQuality,
  startSoup,
} from './helpers';
import { STAGE_QUALITY, THEME_STAGES, type EffectStageName } from './theme-stages';

/** Same-runner ratio budget (planning/README.md §3.6, D6). Tightened by measurement, never loosened. */
const RATIO_BUDGET = 2.5;
/**
 * Peak-to-trough heap over {@link HEAP_FRAMES} frames. Set from measurement on 2026-10-06
 * (headless Chromium 1237, 1080p, soup running): healthy themes span 9.5 MB (Default) and 20.9 MB
 * (Sids-Place); the per-texel passes span 65–263 MB. 32 MB sits between them. Tighten, never loosen.
 */
const HEAP_SPAN_BUDGET_BYTES = 32 * 1024 * 1024;
const HEAP_FRAMES = 300;
const FRAME_SAMPLE_MS = 3_000;
const WARMUP_MS = 1_500;

/**
 * Known-broken checks and the task that owns each fix. Delete the entry in the same commit that
 * fixes the defect (the case then runs as a normal assertion). Keyed `<check>:<theme>[:<stage>]`.
 */
const KNOWN_BROKEN: Readonly<Record<string, string>> = {
  // Post stage: per-texel passes read an all-zero buffer on a real OffscreenCanvas and paint
  // transparent black (ADR-011 amendment). Rebuilt as composited passes by P3-E-2.
  'liveness:chiba-city:post': 'P3-E-2',
  'liveness:flatline:post': 'P3-E-2',
  'liveness:void-walker:post': 'P3-E-2',
  'liveness:synthwave:post': 'P3-E-2',

  // Effects stage. Four distinct causes, all fixed by P3-E-3:
  //  - chiba-city: `birthFlash` never fires — nothing in client/ calls `setChangeSummary`, so
  //    `ctx.changes` is always empty. (`deathParticles` has the same defect in void-walker.)
  //  - flatline: `phosphorDecay` reads zeros, like the post passes.
  //  - void-walker: `trailFade` reads zeros and `deathParticles` never fires.
  //  - synthwave: `gridGlow` draws, then `hueShiftByAge` putImageData()s a zero buffer over the
  //    whole layer, erasing it. putImageData replaces pixels; it does not composite.
  'liveness:chiba-city:effects': 'P3-E-3',
  'liveness:flatline:effects': 'P3-E-3',
  'liveness:void-walker:effects': 'P3-E-3',
  'liveness:synthwave:effects': 'P3-E-3',

  // Background stage, chiba-city and flatline only: their L1 cell layer paints an opaque
  // `theme.background` over the whole viewport, so `hazeGrid` / `textRain` on L0 are fully
  // occluded. void-walker, synthwave and sids-place declare a transparent `cellLayerBackground`
  // and show their L0. This is why the committed chiba-city baseline is flat mint-on-black.
  'liveness:chiba-city:background': 'P3-E-3',
  'liveness:flatline:background': 'P3-E-3',

  // Allocation and frame ratio: every theme with per-texel passes. The marker comes off with the
  // last of the owning tasks, since both stages allocate in flatline, void-walker and synthwave.
  'heap:chiba-city': 'P3-E-2',
  'heap:flatline': 'P3-E-3 (after P3-E-2)',
  'heap:void-walker': 'P3-E-3 (after P3-E-2)',
  'heap:synthwave': 'P3-E-3 (after P3-E-2)',
  'ratio:chiba-city': 'P3-E-2',
  'ratio:flatline': 'P3-E-3 (after P3-E-2)',
  'ratio:void-walker': 'P3-E-3 (after P3-E-2)',
  'ratio:synthwave': 'P3-E-3 (after P3-E-2)',
};

function broken(key: string): string | undefined {
  return KNOWN_BROKEN[key];
}

const LIVENESS_STAGES: readonly EffectStageName[] = ['background', 'effects', 'post'];

test.describe('effect liveness: every enabled stage changes pixels (ADR-012 rule 3)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await pauseSim(page);
  });

  for (const theme of THEME_IDS) {
    for (const stage of LIVENESS_STAGES) {
      const enabled = THEME_STAGES[theme]?.includes(stage) ?? false;
      if (!enabled) continue;
      test(`${theme}: the ${stage} stage changes pixels`, async ({ page }) => {
        const owner = broken(`liveness:${theme}:${stage}`);
        test.fail(owner !== undefined, `known broken, owned by ${owner}`);

        await activateTheme(page, theme);
        const hi = STAGE_QUALITY[stage];
        const lo = hi - 1;
        await snapAtQuality(page, hi, 'hi');
        await snapAtQuality(page, lo, 'lo');
        const changed = await diffPixels(page, 'hi', 'lo');
        expect(
          changed,
          `${theme}: quality ${hi} vs ${lo} differ in ${changed} pixels — the ${stage} stage is enabled but draws nothing`,
        ).toBeGreaterThan(0);
      });
    }
  }
});

test.describe('per-frame cost with the sim running (ADR-012 rules 1 and 4)', () => {
  test.beforeEach(async ({ page }) => {
    await openApp(page);
    await startSoup(page);
    // `?test=1` pins quality at the ceiling, so this is each theme's full stack, honestly.
    expect(await page.evaluate(() => window.__fancyGol?.effectQuality)).toBe(3);
  });

  for (const theme of THEME_IDS) {
    test(`${theme}: heap span over ${HEAP_FRAMES} frames stays small (Chromium-only proxy for allocation)`, async ({
      page,
    }) => {
      const owner = broken(`heap:${theme}`);
      test.fail(owner !== undefined, `known broken, owned by ${owner}`);

      await activateTheme(page, theme);
      await page.waitForTimeout(WARMUP_MS);
      const span = await heapSpanBytes(page, HEAP_FRAMES);
      test.info().annotations.push({ type: 'heap-span-mb', description: (span / 1048576).toFixed(1) });
      expect(span, `${theme}: heap span ${(span / 1048576).toFixed(1)} MB`).toBeLessThanOrEqual(HEAP_SPAN_BUDGET_BYTES);
    });

    if (theme === 'default') continue;
    test(`${theme}: quality-3 frame is within ${RATIO_BUDGET}× of Default on this runner`, async ({ page }) => {
      const owner = broken(`ratio:${theme}`);
      test.fail(owner !== undefined, `known broken, owned by ${owner}`);

      await activateTheme(page, 'default');
      await page.waitForTimeout(WARMUP_MS);
      const baseline = await medianFrameMs(page, FRAME_SAMPLE_MS);

      await activateTheme(page, theme);
      await page.waitForTimeout(WARMUP_MS);
      const frame = await medianFrameMs(page, FRAME_SAMPLE_MS);
      const stats = await page.evaluate(() => window.__fancyGol?.renderStats());

      const ratio = frame / baseline;
      test.info().annotations.push(
        { type: 'median-frame-ms', description: `${frame.toFixed(1)} (default ${baseline.toFixed(1)})` },
        { type: 'ratio', description: ratio.toFixed(2) },
        { type: 'stage-ms', description: JSON.stringify(stats?.stageMs) },
      );
      expect(ratio, `${theme}: ${frame.toFixed(1)} ms vs Default ${baseline.toFixed(1)} ms`).toBeLessThanOrEqual(
        RATIO_BUDGET,
      );
    });
  }
});
