/**
 * Injectable Web Audio graph for node-environment unit tests (P3-B-1 / P3-B-2).
 */
import type {
  AudioBufferLike,
  AudioBufferSourceNodeLike,
  AudioContextLike,
  AudioContextState,
  AudioNodeLike,
  AudioParamLike,
  BiquadFilterNodeLike,
  BiquadFilterTypeName,
  ConvolverNodeLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
  OscillatorNodeLike,
  OscillatorTypeName,
  StereoPannerNodeLike,
} from '../../../src/audio/types';

export interface ParamEvent {
  readonly kind: 'set' | 'linear' | 'expo' | 'cancel';
  readonly value?: number;
  readonly time: number;
}

export class FakeParam implements AudioParamLike {
  value: number;
  readonly events: ParamEvent[] = [];

  constructor(initial = 0) {
    this.value = initial;
  }

  setValueAtTime(value: number, startTime: number): void {
    this.value = value;
    this.events.push({ kind: 'set', value, time: startTime });
  }

  linearRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ kind: 'linear', value, time: endTime });
  }

  exponentialRampToValueAtTime(value: number, endTime: number): void {
    this.value = value;
    this.events.push({ kind: 'expo', value, time: endTime });
  }

  cancelScheduledValues(startTime: number): void {
    this.events.push({ kind: 'cancel', time: startTime });
  }
}

export class FakeNode implements AudioNodeLike {
  readonly connections: AudioNodeLike[] = [];

  connect(dest: AudioNodeLike): AudioNodeLike {
    this.connections.push(dest);
    return dest;
  }

  disconnect(): void {
    this.connections.length = 0;
  }
}

class FakeGain extends FakeNode implements GainNodeLike {
  readonly gain = new FakeParam(1);
}

class FakeCompressor extends FakeNode implements DynamicsCompressorNodeLike {
  readonly threshold = new FakeParam(-24);
  readonly knee = new FakeParam(30);
  readonly ratio = new FakeParam(12);
  readonly attack = new FakeParam(0.003);
  readonly release = new FakeParam(0.25);
}

export class FakeOscillator extends FakeNode implements OscillatorNodeLike {
  type: OscillatorTypeName = 'sine';
  readonly frequency = new FakeParam(440);
  readonly detune = new FakeParam(0);
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

export class FakeBuffer implements AudioBufferLike {
  readonly channels: Float32Array[];

  constructor(
    readonly numberOfChannels: number,
    readonly length: number,
    readonly sampleRate: number,
  ) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }

  getChannelData(channel: number): Float32Array {
    return this.channels[channel]!;
  }
}

export class FakeBufferSource extends FakeNode implements AudioBufferSourceNodeLike {
  buffer: AudioBufferLike | null = null;
  loop = false;
  startedAt: number | null = null;
  stoppedAt: number | null = null;

  start(when = 0): void {
    this.startedAt = when;
  }

  stop(when = 0): void {
    this.stoppedAt = when;
  }
}

export class FakeBiquad extends FakeNode implements BiquadFilterNodeLike {
  type: BiquadFilterTypeName = 'lowpass';
  readonly frequency = new FakeParam(350);
  readonly Q = new FakeParam(1);
  readonly gain = new FakeParam(0);
}

export class FakeStereoPanner extends FakeNode implements StereoPannerNodeLike {
  readonly pan = new FakeParam(0);
}

export class FakeConvolver extends FakeNode implements ConvolverNodeLike {
  buffer: AudioBufferLike | null = null;
  normalize = true;
}

export class FakeAudioContext implements AudioContextLike {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  sampleRate = 48000;
  readonly destination = new FakeNode();
  createGainCount = 0;
  createCompressorCount = 0;
  createOscillatorCount = 0;
  createBufferCount = 0;
  createBufferSourceCount = 0;
  createBiquadCount = 0;
  createPannerCount = 0;
  createConvolverCount = 0;
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;
  readonly oscillators: FakeOscillator[] = [];
  readonly bufferSources: FakeBufferSource[] = [];
  readonly filters: FakeBiquad[] = [];
  readonly panners: FakeStereoPanner[] = [];
  readonly convolvers: FakeConvolver[] = [];

  createGain(): GainNodeLike {
    this.createGainCount += 1;
    return new FakeGain();
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    this.createCompressorCount += 1;
    return new FakeCompressor();
  }

  createOscillator(): OscillatorNodeLike {
    this.createOscillatorCount += 1;
    const osc = new FakeOscillator();
    this.oscillators.push(osc);
    return osc;
  }

  createBuffer(numberOfChannels: number, length: number, sampleRate: number): AudioBufferLike {
    this.createBufferCount += 1;
    return new FakeBuffer(numberOfChannels, length, sampleRate);
  }

  createBufferSource(): AudioBufferSourceNodeLike {
    this.createBufferSourceCount += 1;
    const src = new FakeBufferSource();
    this.bufferSources.push(src);
    return src;
  }

  createBiquadFilter(): BiquadFilterNodeLike {
    this.createBiquadCount += 1;
    const filter = new FakeBiquad();
    this.filters.push(filter);
    return filter;
  }

  createStereoPanner(): StereoPannerNodeLike {
    this.createPannerCount += 1;
    const panner = new FakeStereoPanner();
    this.panners.push(panner);
    return panner;
  }

  createConvolver(): ConvolverNodeLike {
    this.createConvolverCount += 1;
    const conv = new FakeConvolver();
    this.convolvers.push(conv);
    return conv;
  }

  resume(): Promise<void> {
    this.resumeCount += 1;
    this.state = 'running';
    return Promise.resolve();
  }

  suspend(): Promise<void> {
    this.suspendCount += 1;
    this.state = 'suspended';
    return Promise.resolve();
  }

  close(): Promise<void> {
    this.closeCount += 1;
    this.state = 'closed';
    return Promise.resolve();
  }
}

export class FakeVisibility {
  hidden = false;
  private readonly listeners = new Set<() => void>();

  addEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.add(listener);
  }

  removeEventListener(_type: 'visibilitychange', listener: () => void): void {
    this.listeners.delete(listener);
  }

  setHidden(hidden: boolean): void {
    this.hidden = hidden;
    for (const l of this.listeners) l();
  }
}

export class FakeGestureTarget {
  private readonly listeners = new Map<string, Set<() => void>>();

  addEventListener(
    type: string,
    listener: () => void,
    _options?: { once?: boolean; capture?: boolean },
  ): void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
  }

  removeEventListener(
    type: string,
    listener: () => void,
    _options?: { capture?: boolean },
  ): void {
    this.listeners.get(type)?.delete(listener);
  }

  fire(type: string): void {
    const set = this.listeners.get(type);
    if (!set) return;
    for (const l of [...set]) l();
  }

  listenerCount(type: string): number {
    return this.listeners.get(type)?.size ?? 0;
  }
}

export class MemoryStorage {
  private readonly map = new Map<string, string>();

  getItem(key: string): string | null {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }

  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }

  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Manual clock for scheduler tests — no real timers. */
export class ManualClock {
  wallMs = 0;
  private readonly intervals = new Map<number, { fn: () => void; ms: number; next: number }>();
  private nextId = 1;

  nowMs(): number {
    return this.wallMs;
  }

  setInterval(fn: () => void, ms: number): unknown {
    const id = this.nextId++;
    this.intervals.set(id, { fn, ms, next: this.wallMs + ms });
    return id;
  }

  clearInterval(id: unknown): void {
    this.intervals.delete(id as number);
  }

  /** Advance wall clock and fire due intervals (simulates render load between ticks). */
  advance(ms: number, frameMs = 16.667): void {
    const target = this.wallMs + ms;
    while (this.wallMs < target) {
      this.wallMs = Math.min(target, this.wallMs + frameMs);
      for (const entry of this.intervals.values()) {
        while (entry.next <= this.wallMs) {
          entry.fn();
          entry.next += entry.ms;
        }
      }
    }
  }
}
