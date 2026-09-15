/**
 * P3-A-4 — degrade governor (PHASE_3 §2.3).
 *
 * EWMA of frame time with hysteresis:
 *   > 20 ms for 30 consecutive frames  → quality−−  (post → effects → background)
 *   < 12 ms for 300 consecutive frames → quality++  (up to the theme max)
 * Quality 0 = tokens + palette only. A manual pin freezes automatic changes.
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
  if (quality >= 3) return 'effects at full quality';
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

    if (this.ewmaMs > SLOW_MS) {
      this.slowStreak += 1;
      this.fastStreak = 0;
      if (this.slowStreak >= SLOW_STREAK && this.quality > 0) {
        const from = this.quality;
        const to = clampQuality(from - 1, this.maxQuality);
        this.slowStreak = 0;
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
      this.fastStreak += 1;
      this.slowStreak = 0;
      if (this.fastStreak >= FAST_STREAK && this.quality < this.maxQuality) {
        const from = this.quality;
        const to = clampQuality(from + 1, this.maxQuality);
        this.fastStreak = 0;
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
