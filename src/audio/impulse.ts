/**
 * P3-C-5 — synthesised convolution impulse (zero audio assets).
 *
 * Exponentially decaying noise, seeded and deterministic. Void-Walker plucks
 * convolve against this at spawn time; the buffer is generated once per context.
 */
import { Mulberry32 } from '@shared/rng';

export const VOID_REVERB_IMPULSE_SEED = 0x501d;
export const VOID_REVERB_IMPULSE_SECONDS = 1.8;
export const VOID_REVERB_DECAY = 3.2;

export interface ReverbImpulseOptions {
  readonly seed?: number;
  readonly seconds?: number;
  readonly decay?: number;
}

/** Runtime IR — same seed + sampleRate always hashes equal. */
export function synthesizeReverbImpulse(
  sampleRate: number,
  opts: ReverbImpulseOptions = {},
): Float32Array {
  const seconds = opts.seconds ?? VOID_REVERB_IMPULSE_SECONDS;
  const decay = opts.decay ?? VOID_REVERB_DECAY;
  const seed = opts.seed ?? VOID_REVERB_IMPULSE_SEED;
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  const out = new Float32Array(n);
  const rng = new Mulberry32(seed);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] = (rng.next() * 2 - 1) * Math.exp(-decay * t);
  }
  return out;
}
