/**
 * P3-D-4 — the degrade governor, wired.
 *
 * PHASE_3 §2.3 calls the degrade governor "the single most important piece of this phase",
 * and P3-A-4 built and unit-tested it. Until this task nothing in `client/` ever constructed
 * one: `main.ts` made a bare `new Compositor()`, so the quality ladder was dead code and every
 * theme ran at quality 3 unconditionally. P3-D-4 then measured what quality 3 actually costs at
 * 1080p — 37.6 ms (Flatline) to 127.9 ms (Chiba-City) of measured CPU effect time per frame
 * against an 18.18 ms budget — which makes the governor the difference between "beautiful and
 * slow" and "beautiful and smooth". See ADR-011 for the cost analysis and the GPU deferral.
 *
 * Three rules this module owns, because they are the ones a hostile reviewer should check:
 *
 *  1. **Degrade is never silent** (PHASE_3 §2.3). `createDegradeNotifier` announces the first
 *     downgrade once per session through the existing toast region, using the governor's own
 *     plain-language sentence — "which passes were dropped" — rather than a bare "reduced".
 *  2. **`?test=1` pins quality.** Screenshots must not depend on how fast the machine is, and a
 *     slow CI runner downgrading mid-snapshot would make 48 committed baselines (P3-D-2) flaky.
 *     The pin also gives Playwright a deterministic handle on the ladder (`pinQuality`).
 *  3. **The announcement is idempotent and cheap.** The status-bar tick asks every 100 ms; this
 *     answers from the governor's own state with no timers of its own.
 */
import type { EffectQuality } from '@render/effects/ctx';
import type { EffectRegistry } from '@render/effects/registry';
import { QualityGovernor } from '@render/quality-governor';

/** The slice of `Compositor` the governor needs. Structural, so a test can pass a stub. */
export interface QualityHost {
  setQualityGovernor(governor: QualityGovernor | null): void;
  getQualityGovernor(): QualityGovernor | null;
}

export interface AttachDegradeGovernorOptions {
  /** The compositor's live registry — the governor drives quality through it. */
  readonly registry: EffectRegistry;
  /** Theme-declared ceiling. Default 3 (every shipped theme's max). */
  readonly maxQuality?: EffectQuality;
  /** `?test=1` — pin at the ceiling so visual baselines stay machine-independent. */
  readonly testMode?: boolean;
}

/**
 * Construct the governor, hand it to the compositor, and (in test mode) pin it. Returns the
 * governor so the caller can read the indicator and, in tests, pin explicitly.
 */
export function attachDegradeGovernor(
  host: QualityHost,
  options: AttachDegradeGovernorOptions,
): QualityGovernor {
  const maxQuality = options.maxQuality ?? 3;
  const governor = new QualityGovernor({ registry: options.registry, maxQuality });
  host.setQualityGovernor(governor);
  if (options.testMode) governor.pin(maxQuality);
  return governor;
}

/** Freeze automatic changes at `quality` (§2.3's "the user can pin quality manually"). */
export function pinQuality(governor: QualityGovernor | null, quality: EffectQuality): void {
  governor?.pin(quality);
}

/** Release a pin and let the frame-time policy drive again. */
export function unpinQuality(governor: QualityGovernor | null): void {
  governor?.unpin();
}

/**
 * Plain-language status text, or `''` at full quality. `Compositor.qualityIndicatorText()`
 * already does this; re-exported here so callers have one import for the whole feature and one
 * place to test it.
 */
export function qualityIndicatorText(host: QualityHost): string {
  const governor = host.getQualityGovernor();
  if (!governor) return '';
  const text = governor.indicatorText();
  return text === 'effects at full quality' ? '' : text;
}

export interface DegradeNotifier {
  /** Call from the status-bar tick. Announces the first degradation, then never again. */
  check(): void;
  /** True once an announcement has been made (tests). */
  readonly announced: boolean;
  /** Forget the announcement — used when the user activates a new theme. */
  reset(): void;
}

/**
 * Announce the *first* quality drop of a session, once. Repeating it every 100 ms would be
 * unusable, and never saying it at all is the silent degradation PHASE_3 §2.3 forbids.
 */
export function createDegradeNotifier(
  host: QualityHost,
  show: (message: string) => void,
): DegradeNotifier {
  let announced = false;
  return {
    get announced(): boolean {
      return announced;
    },
    reset(): void {
      announced = false;
    },
    check(): void {
      if (announced) return;
      const text = qualityIndicatorText(host);
      if (!text) return;
      announced = true;
      show(text);
    },
  };
}