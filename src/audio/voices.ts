/**
 * P3-B-2 — synthesised voice primitives (zero audio assets).
 *
 * Each voice builds a small node graph, schedules `start`/`stop` against the AudioContext
 * clock, and returns an inspectable handle for tests and oldest-first stealing.
 */
import type {
  AudioBufferLike,
  AudioContextLike,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  ConvolverNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  AudioBufferSourceNodeLike,
  VoiceEnvelope,
  VoiceKind,
  VoiceParams,
} from './types';
import {
  VOID_REVERB_IMPULSE_SEED,
  synthesizeReverbImpulse,
} from './impulse';

export interface VoiceGraph {
  readonly kind: VoiceKind;
  readonly source: OscillatorNodeLike | AudioBufferSourceNodeLike;
  readonly filter: BiquadFilterNodeLike | null;
  readonly envelope: GainNodeLike;
  readonly destination: AudioNodeLike;
  readonly convolver: ConvolverNodeLike | null;
}

export interface VoiceHandle {
  readonly id: number;
  readonly kind: VoiceKind;
  readonly startTime: number;
  readonly stopTime: number;
  readonly graph: VoiceGraph;
  /** Hard-stop immediately (steal / dispose). Safe to call more than once. */
  stop(): void;
  readonly stopped: boolean;
}

export interface SpawnVoiceOptions {
  readonly context: AudioContextLike;
  readonly destination: AudioNodeLike;
  readonly kind: VoiceKind;
  readonly id: number;
  readonly when: number;
  readonly params?: VoiceParams;
  /** Optional shared noise buffer (avoids reallocating on every click/burst). */
  readonly noiseBuffer?: AudioBufferLike;
}

export function spawnVoice(options: SpawnVoiceOptions): VoiceHandle {
  const { context: ctx, destination, kind, id, when } = options;
  const params = options.params ?? {};
  const pitch = positive(params.pitch ?? defaultPitch(kind), defaultPitch(kind));
  const duration = positive(params.duration ?? defaultDuration(kind), defaultDuration(kind));
  const filterHz = positive(params.filter ?? defaultFilter(kind), defaultFilter(kind));
  const peak = clamp01(params.gain ?? defaultGain(kind));
  const env = mergeEnv(kind, params.envelope);
  const startAt = Math.max(when, ctx.currentTime);
  const stopAt = startAt + duration;

  const envelope = ctx.createGain();
  const peakSafe = Math.max(peak, 0.0001);
  if (params.loop) {
    envelope.gain.setValueAtTime(peakSafe, startAt);
  } else {
    envelope.gain.setValueAtTime(0.0001, startAt);
    scheduleAdsr(envelope.gain, startAt, duration, peak, env);
  }
  envelope.connect(destination);

  let source: OscillatorNodeLike | AudioBufferSourceNodeLike;
  let filter: BiquadFilterNodeLike | null = null;
  let convolver: ConvolverNodeLike | null = null;
  if (params.reverb) {
    const ir = getOrCreateImpulseBuffer(ctx);
    convolver = ctx.createConvolver();
    convolver.buffer = ir;
    convolver.normalize = true;
    const wet = ctx.createGain();
    wet.gain.setValueAtTime(0.32, startAt);
    envelope.connect(convolver);
    convolver.connect(wet);
    wet.connect(destination);
  }

  switch (kind) {
    case 'blip': {
      const osc = ctx.createOscillator();
      osc.type = params.waveform ?? 'sine';
      osc.frequency.setValueAtTime(pitch, startAt);
      source = osc;
      if (params.filter !== undefined) {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(filterHz, startAt);
        filter = lp;
        osc.connect(lp);
        lp.connect(envelope);
      } else {
        osc.connect(envelope);
      }
      osc.start(startAt);
      osc.stop(stopAt + env.release);
      break;
    }
    case 'click': {
      const noise = ctx.createBufferSource();
      noise.buffer = options.noiseBuffer ?? getOrCreateNoiseBuffer(ctx, 0.02);
      source = noise;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.setValueAtTime(Math.max(filterHz, 800), startAt);
      filter = hp;
      noise.connect(hp);
      hp.connect(envelope);
      startSource(noise, startAt, stopAt + env.release, Boolean(params.loop));
      break;
    }
    case 'sweep': {
      const osc = ctx.createOscillator();
      osc.type = params.waveform ?? 'sine';
      const end = positive(params.pitchEnd ?? pitch * 2, pitch * 2);
      osc.frequency.setValueAtTime(Math.max(pitch, 1), startAt);
      osc.frequency.exponentialRampToValueAtTime(Math.max(end, 1), stopAt);
      source = osc;
      osc.connect(envelope);
      osc.start(startAt);
      osc.stop(stopAt + env.release);
      break;
    }
    case 'noiseBurst': {
      const noise = ctx.createBufferSource();
      noise.buffer = options.noiseBuffer ?? getOrCreateNoiseBuffer(ctx, 0.25);
      source = noise;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(filterHz, startAt);
      bp.Q.setValueAtTime(4, startAt);
      filter = bp;
      noise.connect(bp);
      bp.connect(envelope);
      startSource(noise, startAt, stopAt + env.release, Boolean(params.loop));
      break;
    }
    case 'pluck': {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(pitch, startAt);
      source = osc;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filterHz, startAt);
      lp.frequency.exponentialRampToValueAtTime(Math.max(filterHz * 0.2, 80), stopAt);
      filter = lp;
      osc.connect(lp);
      lp.connect(envelope);
      osc.start(startAt);
      osc.stop(stopAt + env.release);
      break;
    }
    case 'pad': {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(pitch, startAt);
      source = osc;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filterHz, startAt);
      filter = lp;
      osc.connect(lp);
      lp.connect(envelope);
      osc.start(startAt);
      osc.stop(stopAt + env.release);
      break;
    }
    case 'drone': {
      const osc = ctx.createOscillator();
      osc.type = params.waveform ?? 'sawtooth';
      osc.frequency.setValueAtTime(pitch, startAt);
      source = osc;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(filterHz, startAt);
      filter = lp;
      osc.connect(lp);
      lp.connect(envelope);
      osc.start(startAt);
      osc.stop(stopAt + env.release);
      break;
    }
  }

  let stopped = false;
  const endTime = params.loop ? Number.POSITIVE_INFINITY : stopAt + env.release;
  const handle: VoiceHandle = {
    id,
    kind,
    startTime: startAt,
    stopTime: endTime,
    graph: { kind, source, filter, envelope, destination, convolver },
    get stopped() {
      return stopped;
    },
    stop(): void {
      if (stopped) return;
      stopped = true;
      const now = ctx.currentTime;
      try {
        envelope.gain.cancelScheduledValues(now);
        envelope.gain.setValueAtTime(Math.max(envelope.gain.value, 0.0001), now);
        envelope.gain.linearRampToValueAtTime(0.0001, now + 0.01);
      } catch {
        /* param already cancelled */
      }
      try {
        source.stop(now + 0.012);
      } catch {
        /* already stopped */
      }
      try {
        source.disconnect();
        filter?.disconnect();
        convolver?.disconnect();
        envelope.disconnect();
      } catch {
        /* already disconnected */
      }
    },
  };
  return handle;
}

function startSource(
  node: AudioBufferSourceNodeLike,
  startAt: number,
  stopAt: number,
  loop: boolean,
): void {
  node.loop = loop;
  node.start(startAt);
  if (!loop) node.stop(stopAt);
}

/** Cached per-context noise buffers keyed by duration bucket (ms). */
const noiseCache = new WeakMap<AudioContextLike, Map<number, AudioBufferLike>>();

export function getOrCreateNoiseBuffer(
  ctx: AudioContextLike,
  durationSec: number,
): AudioBufferLike {
  const ms = Math.max(1, Math.round(durationSec * 1000));
  let byDur = noiseCache.get(ctx);
  if (!byDur) {
    byDur = new Map();
    noiseCache.set(ctx, byDur);
  }
  const hit = byDur.get(ms);
  if (hit) return hit;

  const length = Math.max(1, Math.floor(ctx.sampleRate * (ms / 1000)));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  // Deterministic “noise” so tests are stable — LCG, not Math.random.
  let state = (ms * 2654435761) >>> 0;
  for (let i = 0; i < data.length; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    data[i] = (state / 0x100000000) * 2 - 1;
  }
  byDur.set(ms, buffer);
  return buffer;
}

const impulseCache = new WeakMap<AudioContextLike, AudioBufferLike>();

function getOrCreateImpulseBuffer(ctx: AudioContextLike): AudioBufferLike {
  const hit = impulseCache.get(ctx);
  if (hit) return hit;
  const ir = synthesizeReverbImpulse(ctx.sampleRate, { seed: VOID_REVERB_IMPULSE_SEED });
  const buffer = ctx.createBuffer(1, ir.length, ctx.sampleRate);
  buffer.getChannelData(0).set(ir);
  impulseCache.set(ctx, buffer);
  return buffer;
}

function scheduleAdsr(
  gain: AudioParamLike,
  startAt: number,
  duration: number,
  peak: number,
  env: VoiceEnvelope,
): void {
  const peakSafe = Math.max(peak, 0.0001);
  const attackEnd = startAt + env.attack;
  const decayEnd = attackEnd + env.decay;
  const releaseStart = Math.max(decayEnd, startAt + duration - env.release);
  const releaseEnd = startAt + duration + env.release;
  const sustainLevel = Math.max(peakSafe * env.sustain, 0.0001);

  gain.setValueAtTime(0.0001, startAt);
  gain.exponentialRampToValueAtTime(peakSafe, attackEnd);
  if (env.sustain < 0.999) {
    gain.exponentialRampToValueAtTime(sustainLevel, decayEnd);
    gain.setValueAtTime(sustainLevel, releaseStart);
  } else {
    gain.setValueAtTime(peakSafe, releaseStart);
  }
  gain.exponentialRampToValueAtTime(0.0001, releaseEnd);
}

function mergeEnv(kind: VoiceKind, partial?: Partial<VoiceEnvelope>): VoiceEnvelope {
  const base = defaultEnv(kind);
  if (!partial) return base;
  return {
    attack: positive(partial.attack ?? base.attack, base.attack),
    decay: positive(partial.decay ?? base.decay, base.decay),
    sustain: clamp01(partial.sustain ?? base.sustain),
    release: positive(partial.release ?? base.release, base.release),
  };
}

function defaultEnv(kind: VoiceKind): VoiceEnvelope {
  switch (kind) {
    case 'blip':
      return { attack: 0.004, decay: 0.06, sustain: 0, release: 0.04 };
    case 'click':
      return { attack: 0.001, decay: 0.02, sustain: 0, release: 0.01 };
    case 'sweep':
      return { attack: 0.01, decay: 0.05, sustain: 0.4, release: 0.08 };
    case 'noiseBurst':
      return { attack: 0.005, decay: 0.1, sustain: 0.2, release: 0.08 };
    case 'pluck':
      return { attack: 0.002, decay: 0.15, sustain: 0.05, release: 0.1 };
    case 'pad':
      return { attack: 0.25, decay: 0.3, sustain: 0.7, release: 0.4 };
    case 'drone':
      return { attack: 0.4, decay: 0.2, sustain: 0.9, release: 0.5 };
  }
}

function defaultPitch(kind: VoiceKind): number {
  switch (kind) {
    case 'blip':
      return 880;
    case 'click':
      return 2000;
    case 'sweep':
      return 220;
    case 'noiseBurst':
      return 400;
    case 'pluck':
      return 330;
    case 'pad':
      return 110;
    case 'drone':
      return 55;
  }
}

function defaultDuration(kind: VoiceKind): number {
  switch (kind) {
    case 'blip':
      return 0.08;
    case 'click':
      return 0.03;
    case 'sweep':
      return 0.25;
    case 'noiseBurst':
      return 0.18;
    case 'pluck':
      return 0.35;
    case 'pad':
      return 1.2;
    case 'drone':
      return 2.0;
  }
}

function defaultFilter(kind: VoiceKind): number {
  switch (kind) {
    case 'blip':
    case 'sweep':
      return 2000;
    case 'click':
      return 3000;
    case 'noiseBurst':
      return 1200;
    case 'pluck':
      return 2400;
    case 'pad':
      return 800;
    case 'drone':
      return 400;
  }
}

function defaultGain(kind: VoiceKind): number {
  switch (kind) {
    case 'click':
      return 0.35;
    case 'pad':
    case 'drone':
      return 0.2;
    case 'blip':
    case 'sweep':
    case 'noiseBurst':
    case 'pluck':
      return 0.4;
  }
}

function positive(v: number, fallback: number): number {
  return v > 0 && Number.isFinite(v) ? v : fallback;
}

function clamp01(v: number): number {
  if (!(v >= 0)) return 0;
  if (v > 1) return 1;
  return v;
}
