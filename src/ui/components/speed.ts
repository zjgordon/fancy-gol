/**
 * P1-D-2 — the speed control: a logarithmic slider from {@link MIN_TPS} to {@link MAX_TPS}, an
 * "unbounded" toggle that runs as fast as the worker's scheduler allows, and a target/actual TPS
 * readout so a researcher can tell when the simulation itself is the bottleneck rather than
 * silently believing whatever target they asked for ("Show target *and* actual TPS").
 *
 * `TpsMeter` is the actual-TPS measurement: a pure, wall-clock-driven EMA over `(tick, timeMs)`
 * samples fed to it from `WorkerClient.onFrame`. It measures *delivered tick deltas*, not frame
 * arrival cadence — `WorkerClient` coalesces onto `requestAnimationFrame` (P0-G-3), so a caller
 * that free-runs the worker far above ~60Hz still only gets one delivered frame per paint; the
 * *tick* the latest of those frames carries is still exactly right, so `tick1 - tick0` over
 * `time1 - time0` remains an honest measurement of what the worker actually achieved, coalescing
 * or not. Same "no lying about your own numbers" discipline the inception document names — the
 * whole point of this component is to never let a target rate be mistaken for an achieved one.
 */

/** The phase doc's own range: "a logarithmic slider from 0.5 to 1000 TPS". */
export const MIN_TPS = 0.5;
export const MAX_TPS = 1000;

/** How many discrete logarithmic steps `[`/`]` (`sim.speedDown`/`sim.speedUp`) move per press. */
const SPEED_LOG_STEPS = 12;

/** The slider's own resolution — cosmetic only, doesn't bound what `setSpeed` will accept. */
const SLIDER_STEPS = 1000;

function clampTps(tps: number): number {
  return Math.min(MAX_TPS, Math.max(MIN_TPS, tps));
}

/** Maps a TPS in `[MIN_TPS, MAX_TPS]` to a linear slider position in `[0, 1]`. */
export function tpsToSliderPosition(tps: number): number {
  const clamped = clampTps(tps);
  return Math.log(clamped / MIN_TPS) / Math.log(MAX_TPS / MIN_TPS);
}

/** The inverse of {@link tpsToSliderPosition}: a linear `[0, 1]` position to a TPS. */
export function sliderPositionToTps(position: number): number {
  const clamped = Math.min(1, Math.max(0, position));
  return clampTps(MIN_TPS * (MAX_TPS / MIN_TPS) ** clamped);
}

/**
 * One logarithmic step up (`direction > 0`) or down from `currentTps`, clamped to
 * `[MIN_TPS, MAX_TPS]`. `Infinity` (unbounded) steps down to `MAX_TPS`; stepping up from
 * `MAX_TPS` never silently enters unbounded — that's a deliberate, explicit toggle
 * (`SimControl.setSpeed(Infinity)`), never a side effect of repeated `]` presses.
 */
export function stepSpeed(currentTps: number, direction: 1 | -1): number {
  if (currentTps === Infinity) return direction > 0 ? Infinity : MAX_TPS;
  const position = tpsToSliderPosition(currentTps);
  return sliderPositionToTps(position + direction / SPEED_LOG_STEPS);
}

/**
 * Wall-clock-driven actual-TPS measurement: an EMA of instantaneous tick-delta-over-time-delta
 * samples, the same smoothing shape `client/main.ts`'s own `fps` tracker already uses. Reused
 * (not shared — a hand-written duplicate) rather than imported, since `main.ts` isn't itself a
 * module anything can depend on and neither module needed a shared abstraction until this one.
 */
export class TpsMeter {
  private lastTick: number | null = null;
  private lastTimeMs: number | null = null;
  private ema = 0;

  /** Feed one `(tick, wall-clock ms)` sample. Call once per delivered worker frame. */
  sample(tick: number, nowMs: number): void {
    if (this.lastTick !== null && this.lastTimeMs !== null) {
      const dTick = tick - this.lastTick;
      const dTimeMs = nowMs - this.lastTimeMs;
      if (dTimeMs > 0 && dTick >= 0) {
        const instant = (dTick / dTimeMs) * 1000;
        this.ema = this.ema === 0 ? instant : this.ema * 0.8 + instant * 0.2;
      }
    }
    this.lastTick = tick;
    this.lastTimeMs = nowMs;
  }

  get actualTps(): number {
    return this.ema;
  }

  /** Discards accumulated history — call whenever the target changes or the run toggles, so a
   * stale rate from before the change doesn't linger and mislead. */
  reset(): void {
    this.lastTick = null;
    this.lastTimeMs = null;
    this.ema = 0;
  }
}

function formatTps(tps: number): string {
  if (tps === Infinity) return 'unbounded';
  return tps >= 100 ? tps.toFixed(0) : tps.toFixed(1);
}

export interface SpeedControlState {
  readonly targetTps: number;
  readonly actualTps: number;
}

export interface SpeedControl {
  readonly root: HTMLElement;
  update(state: SpeedControlState): void;
  dispose(): void;
}

/**
 * Builds the speed slider + unbounded toggle + target/actual readout. `onSetSpeed` is called
 * with the new target whenever the user moves the slider or toggles unbounded — wiring that to
 * `bus.run('sim.speedTo', tps)` (or an equivalent direct `SimControl.setSpeed` call) is the
 * caller's job, matching every other component in `ui/components/` (dumb DOM + callbacks, no
 * direct worker access — `ui/` cannot reach it anyway, ADR-009).
 */
export function createSpeedControl(onSetSpeed: (tps: number) => void): SpeedControl {
  const root = document.createElement('div');
  root.className = 'chrome-panel speed-control';

  const row = document.createElement('div');
  row.className = 'row speed-readout';
  const targetLabel = document.createElement('span');
  targetLabel.className = 'label';
  const actualValue = document.createElement('span');
  row.append(targetLabel, actualValue);

  const sliderRow = document.createElement('div');
  sliderRow.className = 'speed-slider-row';

  const slider = document.createElement('input');
  slider.type = 'range';
  slider.className = 'speed-slider';
  slider.min = '0';
  slider.max = String(SLIDER_STEPS);
  slider.step = '1';
  slider.setAttribute('aria-label', 'Simulation speed');

  const unboundedToggle = document.createElement('button');
  unboundedToggle.type = 'button';
  unboundedToggle.className = 'speed-unbounded';
  unboundedToggle.textContent = '∞'; // ∞
  unboundedToggle.title = 'Unbounded — run as fast as the worker allows';
  unboundedToggle.setAttribute('aria-label', 'Unbounded speed');
  unboundedToggle.setAttribute('aria-pressed', 'false');

  sliderRow.append(slider, unboundedToggle);
  root.append(row, sliderRow);

  // The single source of truth for "what's the current target" is whatever `update()` was last
  // told — not a separate copy this component mutates on its own — so the unbounded toggle's
  // next state is always consistent with what the caller (main.ts) actually confirmed, not with
  // an optimistic local guess that could drift from it.
  let lastTargetTps = MAX_TPS / 2;

  slider.addEventListener('input', () => {
    onSetSpeed(sliderPositionToTps(Number(slider.value) / SLIDER_STEPS));
  });

  unboundedToggle.addEventListener('click', () => {
    // Toggling off returns to MAX_TPS rather than remembering the pre-unbounded value — simple,
    // predictable, and matches stepSpeed's own "stepping down from unbounded lands on MAX_TPS"
    // rule rather than introducing a second, inconsistent way back to a bounded speed.
    onSetSpeed(lastTargetTps === Infinity ? MAX_TPS : Infinity);
  });

  function update(state: SpeedControlState): void {
    lastTargetTps = state.targetTps;
    targetLabel.textContent = `target ${formatTps(state.targetTps)}`;
    actualValue.textContent = `actual ${formatTps(state.actualTps)}`;

    const unbounded = state.targetTps === Infinity;
    unboundedToggle.setAttribute('aria-pressed', String(unbounded));
    slider.disabled = unbounded;
    if (!unbounded) slider.value = String(Math.round(tpsToSliderPosition(state.targetTps) * SLIDER_STEPS));
  }

  return {
    root,
    update,
    dispose(): void {
      // Elements are removed from the DOM by whoever mounted `root`; nothing here holds an
      // external listener (`window`/`document`) that would otherwise outlive `root` itself.
    },
  };
}
