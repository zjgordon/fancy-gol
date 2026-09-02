/**
 * The engine measures its own step time (`TickStats.stepMicros`) but must never touch
 * `performance` or `Date` directly (ADR-009 / the Pure Logic rule) — it asks for time
 * through this injected interface instead. A real implementation backed by
 * `performance.now()` lives outside `src/engine/**` (worker/client wiring).
 */
export interface Clock {
  /** Monotonic microseconds. Only deltas between calls are meaningful. */
  now(): number;
}

/** A manually-advanced clock so tests can assert `stepMicros` deterministically. */
export class TestClock implements Clock {
  private micros = 0;

  now(): number {
    return this.micros;
  }

  /** Move the clock forward (or backward) by a number of microseconds. */
  advance(micros: number): void {
    this.micros += micros;
  }

  /** Jump directly to an absolute time. */
  set(micros: number): void {
    this.micros = micros;
  }
}
