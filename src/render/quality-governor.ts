/**
 * P3-A-4 — degrade governor (PHASE_3 §2.3).
 *
 * EWMA of frame time with hysteresis:
 *   > 20 ms for 30 consecutive frames  → quality−−  (post → effects → background)
 *   < 12 ms for 300 consecutive frames → quality++  (up to the theme max)
 * Quality 0 = tokens + palette only. A manual pin freezes automatic changes.
 *
 * P3-E-4 / ADR-012 rule 4 — **the governor predicts before it promotes.** Reactive hysteresis alone
 * saw-tooths: drop post (frame 16 ms), see 16 < 20... then 300 fast frames later restore it, the
 * frame is 60 ms again, drop again. So a downgrade remembers what the dropped stage cost, a
 * promotion needs `ewma + remembered cost < FAST_MS`, and a promotion that is undone within
 * {@link FAILED_PROBE_FRAMES} frames doubles the wait before the next one (capped).
 */
import type { EffectQuality } from './effects/ctx';
import { stagesForQuality } from './effects/ctx';
import type { EffectPass, EffectStage } from './effects/pass';
import type { EffectRegistry } from './effects/registry';

/** Stages dropped as quality falls: post first, then effects, then background. */
const DROP_ORDER: readonly EffectStage[] = ['post', 'effects', 'background'];

const EWMA_WINDOW = 30;
const EWMA_ALPHA = 2 / (EWMA_WINDOW + 1);
const SLOW_MS = 20;
const FAST_MS = 12;
const SLOW_STREAK = 30;
const FAST_STREAK = 300;
/** A downgrade this soon after a promotion means the promotion failed. */
const FAILED_PROBE_FRAMES = 60;
const MAX_PROBE_INTERVAL = 4800;
/** A promotion that survives this long counts as settled: the probe interval relaxes to the base. */
const SETTLED_FRAMES = 600;

export type QualityChangeReason =
  | {
      readonly kind: 'downgrade';
      readonly from: EffectQuality;
      readonly to: EffectQuality;
      readonly ewmaMs: number;
      /** Plain-language list of stages no longer running. */
      readonly dropped: string;
    }
  | {
      readonly kind: 'upgrade';
      readonly from: EffectQuality;
      readonly to: EffectQuality;
      readonly ewmaMs: number;
      readonly restored: string;
    }
  | {
      readonly kind: 'pin';
      readonly quality: EffectQuality;
    }
  | {
      readonly kind: 'unpin';
      readonly quality: EffectQuality;
    };

export interface QualityGovernorOptions {
  readonly registry: EffectRegistry;
  /** Theme-declared ceiling (ADR-008 `cost` maps here later). Default 3. */
  readonly maxQuality?: EffectQuality;
  readonly initialQuality?: EffectQuality;
}

function clampQuality(q: number, max: EffectQuality): EffectQuality {
  if (q <= 0) return 0;
  if (q >= max) return max;
  return q as EffectQuality;
}

/** Stages that are *not* running at this quality — for the status indicator. */
export function droppedStages(quality: EffectQuality): readonly EffectStage[] {
  return DROP_ORDER.filter((s) => !stagesForQuality(quality).includes(s));
}

function describeStages(stages: readonly EffectStage[]): string {
  if (stages.length === 0) return 'none';
  const labels: Record<EffectStage, string> = {
    post: 'post-processing',
    effects: 'particle and trail effects',
    background: 'animated background',
  };
  return stages.map((s) => labels[s]).join(', ');
}

/**
 * Plain-language explanation of what the user is missing at the current quality —
 * never silent (PHASE_3 §2.3).
 */
export function describeQualityIndicator(
  quality: EffectQuality,
  passes: readonly EffectPass[],
): string {
  if (quality >= 3) {
    // ADR-012 D3: a stand-in is never presented as the real thing. Only the approximating passes
    // are named, so themes without one keep the exact string `qualityIndicatorText` filters out.
    const approximations = passes.flatMap((p) => (p.approximation ? [`${p.id}: ${p.approximation}`] : []));
    return approximations.length > 0
      ? `effects at full quality — approximated: ${approximations.join('; ')}`
      : 'effects at full quality';
  }
  const dropped = droppedStages(quality);
  const named = passes.filter((p) => dropped.includes(p.stage)).map((p) => p.id);
  const stageText = describeStages(dropped);
  if (quality === 0) {
    return named.length > 0
      ? `effects reduced to palette only — dropped ${stageText} (${named.join(', ')})`
      : `effects reduced to palette only — dropped ${stageText}`;
  }
  return named.length > 0
    ? `effects reduced — dropped ${stageText} (${named.join(', ')})`
    : `effects reduced — dropped ${stageText}`;
}

export class QualityGovernor {
  private readonly registry: EffectRegistry;
  private maxQuality: EffectQuality;
  private quality: EffectQuality;
  private pinned: EffectQuality | null = null;
  private ewmaMs = 0;
  private ewmaReady = false;
  private slowStreak = 0;
  private fastStreak = 0;
  /** Frames the EWMA must predict a safe promotion before one is tried (doubles on a failed probe). */
  private probeInterval = FAST_STREAK;
  /** Frames since the last promotion; `null` when none is outstanding. */
  private sincePromotion: number | null = null;
  /** Measured cost (ms) of the stages each downgrade removed, keyed by the quality it dropped from. */
  private readonly droppedCost = new Map<EffectQuality, number>();
  private lastReason: QualityChangeReason;
  private transitionCount = 0;

  constructor(opts: QualityGovernorOptions) {
    this.registry = opts.registry;
    this.maxQuality = opts.maxQuality ?? 3;
    this.quality = clampQuality(opts.initialQuality ?? this.maxQuality, this.maxQuality);
    this.registry.setQuality(this.quality);
    this.lastReason = { kind: 'unpin', quality: this.quality };
    this.transitionCount = 0;
  }

  getQuality(): EffectQuality {
    return this.quality;
  }

  getMaxQuality(): EffectQuality {
    return this.maxQuality;
  }

  /** Raise or lower the theme ceiling (e.g. after activating a `cost: 'low'` theme). */
  setMaxQuality(max: EffectQuality): void {
    this.maxQuality = max;
    this.clearCostMemory();
    if (this.pinned !== null) {
      this.pinned = clampQuality(this.pinned, max);
      this.applyQuality(this.pinned, { kind: 'pin', quality: this.pinned });
      return;
    }
    if (this.quality > max) {
      this.applyQuality(max, {
        kind: 'downgrade',
        from: this.quality,
        to: max,
        ewmaMs: this.ewmaMs,
        dropped: describeStages(droppedStages(max)),
      });
    }
  }

  /**
   * Forget what dropped stages cost and relax the probe interval. A new theme (or a resize) is a new
   * pass stack at a new size: the old numbers describe something that no longer exists.
   */
  clearCostMemory(): void {
    this.droppedCost.clear();
    this.probeInterval = FAST_STREAK;
    this.sincePromotion = null;
    this.fastStreak = 0;
  }

  /**
   * A theme switch: a new pass stack with its own ceiling. Release any pin (a pin chosen against
   * the old theme says nothing about this one), start from the new ceiling and re-measure from the
   * top. Distinct from {@link setMaxQuality}, which only moves the ceiling under the current verdict.
   */
  switchTheme(max: EffectQuality): void {
    this.maxQuality = max;
    this.clearCostMemory();
    this.pinned = null;
    this.slowStreak = 0;
    this.fastStreak = 0;
    this.applyQuality(max, { kind: 'unpin', quality: max });
  }

  /** The probe interval in frames — exposed so tests can see the back-off. */
  getProbeIntervalFrames(): number {
    return this.probeInterval;
  }

  /** Sum of the live passes' costs in the stages that differ between two qualities. */
  private stageCost(from: EffectQuality, to: EffectQuality): number {
    const lost = stagesForQuality(from).filter((s) => !stagesForQuality(to).includes(s));
    let sum = 0;
    for (const pass of this.registry.list()) if (lost.includes(pass.stage)) sum += pass.cost;
    return sum;
  }

  isPinned(): boolean {
    return this.pinned !== null;
  }

  /** Freeze automatic degrade/upgrade at `quality`, or at the current level if omitted. */
  pin(quality?: EffectQuality): void {
    const q = clampQuality(quality ?? this.quality, this.maxQuality);
    this.pinned = q;
    this.slowStreak = 0;
    this.fastStreak = 0;
    this.applyQuality(q, { kind: 'pin', quality: q });
  }

  unpin(): void {
    this.pinned = null;
    this.slowStreak = 0;
    this.fastStreak = 0;
    this.lastReason = { kind: 'unpin', quality: this.quality };
  }

  getEwmaMs(): number {
    return this.ewmaMs;
  }

  getLastReason(): QualityChangeReason {
    return this.lastReason;
  }

  /** How many automatic or pin-driven quality changes have occurred (oscillation tests). */
  getTransitionCount(): number {
    return this.transitionCount;
  }

  /** Status-bar copy: which passes/stages were dropped, in plain language. */
  indicatorText(): string {
    return describeQualityIndicator(this.quality, this.registry.list());
  }

  /**
   * Feed one frame's measured cost (ms). Updates EWMA and maybe steps quality.
   * When pinned, still updates EWMA (for display) but never changes quality.
   */
  observeFrame(frameMs: number): void {
    if (!(frameMs >= 0) || !Number.isFinite(frameMs)) return;
    // Skip the compositor's pre-first-draw zero so EWMA is not poisoned by a fake sample.
    if (!this.ewmaReady && frameMs === 0) return;

    if (!this.ewmaReady) {
      this.ewmaMs = frameMs;
      this.ewmaReady = true;
    } else {
      this.ewmaMs = EWMA_ALPHA * frameMs + (1 - EWMA_ALPHA) * this.ewmaMs;
    }

    if (this.pinned !== null) return;

    if (this.sincePromotion !== null) {
      this.sincePromotion += 1;
      if (this.sincePromotion >= SETTLED_FRAMES) {
        this.probeInterval = FAST_STREAK;
        this.sincePromotion = null;
      }
    }

    if (this.ewmaMs > SLOW_MS) {
      this.slowStreak += 1;
      this.fastStreak = 0;
      if (this.slowStreak >= SLOW_STREAK && this.quality > 0) {
        const from = this.quality;
        const to = clampQuality(from - 1, this.maxQuality);
        this.slowStreak = 0;
        // Measure the stage while its passes still hold their EWMA, before it stops running.
        this.droppedCost.set(from, this.stageCost(from, to));
        if (this.sincePromotion !== null && this.sincePromotion < FAILED_PROBE_FRAMES) {
          this.probeInterval = Math.min(this.probeInterval * 2, MAX_PROBE_INTERVAL);
        }
        this.sincePromotion = null;
        this.applyQuality(to, {
          kind: 'downgrade',
          from,
          to,
          ewmaMs: this.ewmaMs,
          dropped: describeStages(droppedStages(to)),
        });
      }
      return;
    }

    if (this.ewmaMs < FAST_MS) {
      this.slowStreak = 0;
      if (this.quality >= this.maxQuality) {
        this.fastStreak = 0;
        return;
      }
      const from = this.quality;
      const to = clampQuality(from + 1, this.maxQuality);
      // The EWMA is of frames *without* the stage; restoring it adds back what it cost when it ran.
      const cost = this.droppedCost.get(to) ?? this.stageCost(to, from);
      if (this.ewmaMs + cost >= FAST_MS) {
        this.fastStreak = 0;
        return;
      }
      this.fastStreak += 1;
      if (this.fastStreak >= this.probeInterval) {
        this.fastStreak = 0;
        this.sincePromotion = 0;
        this.applyQuality(to, {
          kind: 'upgrade',
          from,
          to,
          ewmaMs: this.ewmaMs,
          restored: describeStages(
            stagesForQuality(to).filter((s) => !stagesForQuality(from).includes(s)),
          ),
        });
      }
      return;
    }

    // Borderline band (12–20 ms): clear both streaks — hysteresis against oscillation.
    this.slowStreak = 0;
    this.fastStreak = 0;
  }

  private applyQuality(q: EffectQuality, reason: QualityChangeReason): void {
    if (q === this.quality && reason.kind !== 'pin' && reason.kind !== 'unpin') return;
    if (q !== this.quality) this.transitionCount += 1;
    this.quality = q;
    this.registry.setQuality(q);
    this.lastReason = reason;
  }
}
