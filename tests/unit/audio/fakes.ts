/**
 * Injectable Web Audio graph for node-environment unit tests (P3-B-1).
 * Tracks param automation so mute ramps are assertable without a real AudioContext.
 */
import type {
  AudioContextLike,
  AudioContextState,
  AudioNodeLike,
  AudioParamLike,
  DynamicsCompressorNodeLike,
  GainNodeLike,
} from '../../../src/audio/types';

export interface ParamEvent {
  readonly kind: 'set' | 'linear' | 'cancel';
  readonly value?: number;
  readonly time: number;
}

class FakeParam implements AudioParamLike {
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

  cancelScheduledValues(startTime: number): void {
    this.events.push({ kind: 'cancel', time: startTime });
  }
}

class FakeNode implements AudioNodeLike {
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

export class FakeAudioContext implements AudioContextLike {
  state: AudioContextState = 'suspended';
  currentTime = 0;
  readonly destination = new FakeNode();
  createGainCount = 0;
  createCompressorCount = 0;
  resumeCount = 0;
  suspendCount = 0;
  closeCount = 0;

  createGain(): GainNodeLike {
    this.createGainCount += 1;
    return new FakeGain();
  }

  createDynamicsCompressor(): DynamicsCompressorNodeLike {
    this.createCompressorCount += 1;
    return new FakeCompressor();
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
