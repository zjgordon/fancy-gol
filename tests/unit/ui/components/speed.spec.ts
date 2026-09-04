import { describe, expect, it } from 'vitest';
import {
  createSpeedControl,
  MAX_TPS,
  MIN_TPS,
  sliderPositionToTps,
  stepSpeed,
  TpsMeter,
  tpsToSliderPosition,
} from '@ui/components/speed';

describe('tpsToSliderPosition / sliderPositionToTps', () => {
  it('round-trips across the full range', () => {
    for (const tps of [MIN_TPS, 1, 5, 30, 100, 500, MAX_TPS]) {
      const position = tpsToSliderPosition(tps);
      expect(position).toBeGreaterThanOrEqual(0);
      expect(position).toBeLessThanOrEqual(1);
      expect(sliderPositionToTps(position)).toBeCloseTo(tps, 6);
    }
  });

  it('maps the endpoints exactly', () => {
    expect(tpsToSliderPosition(MIN_TPS)).toBeCloseTo(0, 9);
    expect(tpsToSliderPosition(MAX_TPS)).toBeCloseTo(1, 9);
    expect(sliderPositionToTps(0)).toBeCloseTo(MIN_TPS, 9);
    expect(sliderPositionToTps(1)).toBeCloseTo(MAX_TPS, 9);
  });

  it('is logarithmic, not linear: the midpoint position is the geometric mean, not the arithmetic one', () => {
    const midTps = sliderPositionToTps(0.5);
    expect(midTps).toBeCloseTo(Math.sqrt(MIN_TPS * MAX_TPS), 6);
    expect(midTps).not.toBeCloseTo((MIN_TPS + MAX_TPS) / 2, 0);
  });

  it('clamps out-of-range input rather than extrapolating', () => {
    expect(sliderPositionToTps(-1)).toBe(MIN_TPS);
    expect(sliderPositionToTps(2)).toBe(MAX_TPS);
    expect(tpsToSliderPosition(0)).toBe(0);
    expect(tpsToSliderPosition(MAX_TPS * 10)).toBe(1);
  });
});

describe('stepSpeed', () => {
  it('steps up and down logarithmically, staying within [MIN_TPS, MAX_TPS]', () => {
    let tps = 30;
    for (let i = 0; i < 50; i++) {
      tps = stepSpeed(tps, 1);
      expect(tps).toBeGreaterThanOrEqual(MIN_TPS);
      expect(tps).toBeLessThanOrEqual(MAX_TPS);
    }
    expect(tps).toBe(MAX_TPS); // 50 up-steps from anywhere in range saturates at the ceiling
  });

  it('a step up genuinely increases the value (for a value not already at the ceiling)', () => {
    expect(stepSpeed(30, 1)).toBeGreaterThan(30);
  });

  it('a step down genuinely decreases the value (for a value not already at the floor)', () => {
    expect(stepSpeed(30, -1)).toBeLessThan(30);
  });

  it('stepping up from Infinity (unbounded) stays at Infinity', () => {
    expect(stepSpeed(Infinity, 1)).toBe(Infinity);
  });

  it('stepping down from Infinity (unbounded) lands on MAX_TPS, not a silent jump elsewhere', () => {
    expect(stepSpeed(Infinity, -1)).toBe(MAX_TPS);
  });

  it('never enters unbounded on its own — stepping up from MAX_TPS stays at MAX_TPS', () => {
    expect(stepSpeed(MAX_TPS, 1)).toBe(MAX_TPS);
  });
});

describe('TpsMeter', () => {
  it('reports 0 before any two samples have been taken', () => {
    const meter = new TpsMeter();
    expect(meter.actualTps).toBe(0);
    meter.sample(0, 1000);
    expect(meter.actualTps).toBe(0); // one sample alone has no delta to measure from
  });

  it('converges to within 5% of a real achieved rate fed at exactly that rate', () => {
    // Simulates a worker genuinely achieving 20 ticks/sec: one tick every 50ms, sampled as
    // WorkerClient.onFrame would deliver them. This is the "achieved TPS is within 5% of target"
    // acceptance criterion proven at the level this codebase actually controls — the measurement
    // itself — since a real machine's true ceiling isn't something a unit test can assert on.
    const meter = new TpsMeter();
    const targetTps = 20;
    const intervalMs = 1000 / targetTps;
    let tick = 0;
    let now = 0;
    for (let i = 0; i < 60; i++) {
      tick += 1;
      now += intervalMs;
      meter.sample(tick, now);
    }
    expect(meter.actualTps).toBeGreaterThan(targetTps * 0.95);
    expect(meter.actualTps).toBeLessThan(targetTps * 1.05);
  });

  it('honestly reflects a rate below target rather than reporting the target', () => {
    // A worker that can only actually manage 340 ticks/sec against a 1000 target — the exact
    // "target 1000 / actual 340" scenario the phase doc names.
    const meter = new TpsMeter();
    let tick = 0;
    let now = 0;
    for (let i = 0; i < 60; i++) {
      tick += 1;
      now += 1000 / 340;
      meter.sample(tick, now);
    }
    expect(meter.actualTps).toBeGreaterThan(340 * 0.9);
    expect(meter.actualTps).toBeLessThan(340 * 1.1);
    expect(meter.actualTps).toBeLessThan(1000 * 0.5); // nowhere near the target — never silently lies
  });

  it('reset() discards history so a stale rate never lingers across a target change', () => {
    const meter = new TpsMeter();
    meter.sample(0, 0);
    meter.sample(100, 1000); // 100 tps
    expect(meter.actualTps).toBeGreaterThan(0);
    meter.reset();
    expect(meter.actualTps).toBe(0);
  });

  it('ignores a non-positive time delta (a clock that didn\'t advance) rather than dividing by zero', () => {
    const meter = new TpsMeter();
    meter.sample(0, 1000);
    meter.sample(5, 1000); // same timestamp
    expect(Number.isFinite(meter.actualTps)).toBe(true);
    expect(meter.actualTps).toBe(0);
  });
});

describe('createSpeedControl', () => {
  it('exposes an accessibly-named slider and unbounded toggle', () => {
    const control = createSpeedControl(() => {});
    const slider = control.root.querySelector('input[type="range"]')!;
    const toggle = control.root.querySelector('button')!;
    expect(slider.getAttribute('aria-label')).toBeTruthy();
    expect(toggle.getAttribute('aria-label')).toBeTruthy();
  });

  it('update() renders both target and actual TPS, honestly labelled even when they diverge', () => {
    const control = createSpeedControl(() => {});
    control.update({ targetTps: 1000, actualTps: 340 });
    expect(control.root.textContent).toContain('target 1000');
    expect(control.root.textContent).toContain('actual 340');
  });

  it('moving the slider calls onSetSpeed with the mapped TPS', () => {
    let received: number | undefined;
    const control = createSpeedControl((tps) => (received = tps));
    const slider = control.root.querySelector<HTMLInputElement>('input[type="range"]')!;
    slider.value = '1000'; // top of the slider's own 0..1000 scale === position 1 === MAX_TPS
    slider.dispatchEvent(new Event('input'));
    expect(received).toBeCloseTo(MAX_TPS, 6);
  });

  it('clicking the unbounded toggle sets speed to Infinity, and again returns to MAX_TPS', () => {
    let received: number | undefined;
    const control = createSpeedControl((tps) => (received = tps));
    const toggle = control.root.querySelector<HTMLButtonElement>('.speed-unbounded')!;

    toggle.click();
    expect(received).toBe(Infinity);
    control.update({ targetTps: Infinity, actualTps: 0 });
    expect(toggle.getAttribute('aria-pressed')).toBe('true');

    toggle.click();
    expect(received).toBe(MAX_TPS);
  });

  it('disables the slider while unbounded, and re-enables it once bounded again', () => {
    const control = createSpeedControl(() => {});
    const slider = control.root.querySelector<HTMLInputElement>('input[type="range"]')!;

    control.update({ targetTps: Infinity, actualTps: 0 });
    expect(slider.disabled).toBe(true);

    control.update({ targetTps: 30, actualTps: 30 });
    expect(slider.disabled).toBe(false);
  });

  it('shows "unbounded" rather than "Infinity" in the readout', () => {
    const control = createSpeedControl(() => {});
    control.update({ targetTps: Infinity, actualTps: 0 });
    expect(control.root.textContent).toContain('unbounded');
    expect(control.root.textContent).not.toContain('Infinity');
  });
});
