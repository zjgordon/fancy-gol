/**
 * Mulberry32 — a small, fast, deterministic PRNG. All randomness in the engine flows through
 * an instance of this class (README §3.8: determinism is load-bearing, not a nicety).
 */
export class Mulberry32 {
  private a: number;

  constructor(seed: number) {
    this.a = seed >>> 0;
  }

  /** The internal state, for snapshotting. Restore with `new Mulberry32(state)`. */
  get state(): number {
    return this.a >>> 0;
  }

  /** Next value in `[0, 1)`. */
  next(): number {
    this.a = (this.a + 0x6d2b79f5) | 0;
    let t = this.a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Next integer in `[0, n)`. */
  nextInt(n: number): number {
    return Math.floor(this.next() * n);
  }

  /**
   * An independent child stream, derived from the current state without consuming it —
   * calling `fork()` never advances `this`. Uses a distinct mixing function (not `next()`'s)
   * so the child's sequence does not collide with the parent's future output.
   */
  fork(): Mulberry32 {
    let t = (this.a ^ 0x9e3779b9) >>> 0;
    t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
    t = Math.imul(t ^ (t >>> 15), 0x735a2d97);
    t = (t ^ (t >>> 15)) >>> 0;
    return new Mulberry32(t);
  }

  /** Restore a previously snapshotted {@link state}. Used by `Simulation.restore`. */
  reset(state: number): void {
    this.a = state >>> 0;
  }
}
