/**
 * P3-B-1 — lazy AudioContext: created and resumed only after the first user gesture.
 *
 * Suspends on `visibilitychange` (tab hide) and on simulation pause; resumes when both allow
 * and the context was previously unlocked. Never constructs an AudioContext at module load.
 */
import type { AudioContextFactory, AudioContextLike } from './types';

export interface VisibilityTarget {
  addEventListener(type: 'visibilitychange', listener: () => void): void;
  removeEventListener(type: 'visibilitychange', listener: () => void): void;
  readonly hidden: boolean;
}

export interface GestureTarget {
  addEventListener(
    type: 'pointerdown' | 'keydown' | 'touchstart',
    listener: () => void,
    options?: { once?: boolean; capture?: boolean },
  ): void;
  removeEventListener(
    type: 'pointerdown' | 'keydown' | 'touchstart',
    listener: () => void,
    options?: { capture?: boolean },
  ): void;
}

export interface AudioRuntimeOptions {
  readonly createContext?: AudioContextFactory;
  readonly visibility?: VisibilityTarget | null;
  readonly gestureTarget?: GestureTarget | null;
  /** Auto-bind unlock listeners on the gesture target. Default true. */
  readonly autoBindGestures?: boolean;
}

const GESTURE_TYPES = ['pointerdown', 'keydown', 'touchstart'] as const;

function defaultFactory(): AudioContextLike {
  const AC =
    typeof globalThis !== 'undefined'
      ? ((globalThis as { AudioContext?: new () => AudioContext }).AudioContext ??
        (globalThis as { webkitAudioContext?: new () => AudioContext }).webkitAudioContext)
      : undefined;
  if (!AC) {
    throw new Error('audio: no AudioContext constructor in this environment');
  }
  return new AC() as unknown as AudioContextLike;
}

export class AudioRuntime {
  private readonly createContext: AudioContextFactory;
  private readonly visibility: VisibilityTarget | null;
  private readonly gestureTarget: GestureTarget | null;
  private ctx: AudioContextLike | null = null;
  private unlocked = false;
  private simulationPaused = false;
  private disposed = false;
  private readonly onVisibility: () => void;
  private readonly onGesture: () => void;
  private gestureBound = false;

  constructor(options: AudioRuntimeOptions = {}) {
    this.createContext = options.createContext ?? defaultFactory;
    this.visibility = options.visibility === undefined ? defaultVisibility() : options.visibility;
    this.gestureTarget =
      options.gestureTarget === undefined ? defaultGestureTarget() : options.gestureTarget;
    this.onVisibility = () => {
      void this.syncSuspendResume();
    };
    this.onGesture = () => {
      void this.unlock();
    };
    this.visibility?.addEventListener('visibilitychange', this.onVisibility);
    if (options.autoBindGestures !== false) this.bindGestures();
  }

  /** True after a successful unlock (gesture). Context may still be suspended for pause/hide. */
  isUnlocked(): boolean {
    return this.unlocked;
  }

  /** The live context, or `null` until the first gesture creates it. */
  getContext(): AudioContextLike | null {
    return this.ctx;
  }

  /** How many times a context has been constructed (tests: must stay 0 pre-gesture). */
  get contextCreationCount(): number {
    return this.ctx ? 1 : 0;
  }

  /**
   * Create (if needed) and resume the AudioContext. Safe to call repeatedly.
   * Returns false if the environment cannot create a context.
   */
  async unlock(): Promise<boolean> {
    this.ensureAlive();
    if (!this.ctx) {
      try {
        this.ctx = this.createContext();
      } catch {
        return false;
      }
    }
    this.unlocked = true;
    this.unbindGestures();
    await this.syncSuspendResume();
    return true;
  }

  setSimulationPaused(paused: boolean): void {
    this.ensureAlive();
    this.simulationPaused = paused;
    void this.syncSuspendResume();
  }

  isSimulationPaused(): boolean {
    return this.simulationPaused;
  }

  isDocumentHidden(): boolean {
    return this.visibility?.hidden ?? false;
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    this.visibility?.removeEventListener('visibilitychange', this.onVisibility);
    this.unbindGestures();
    if (this.ctx) {
      try {
        await this.ctx.close();
      } catch {
        /* already closed */
      }
      this.ctx = null;
    }
    this.unlocked = false;
  }

  private bindGestures(): void {
    if (!this.gestureTarget || this.gestureBound) return;
    for (const type of GESTURE_TYPES) {
      this.gestureTarget.addEventListener(type, this.onGesture, { capture: true });
    }
    this.gestureBound = true;
  }

  private unbindGestures(): void {
    if (!this.gestureTarget || !this.gestureBound) return;
    for (const type of GESTURE_TYPES) {
      this.gestureTarget.removeEventListener(type, this.onGesture, { capture: true });
    }
    this.gestureBound = false;
  }

  private async syncSuspendResume(): Promise<void> {
    if (!this.ctx || !this.unlocked) return;
    const shouldRun = !this.simulationPaused && !this.isDocumentHidden();
    if (shouldRun) {
      if (this.ctx.state === 'suspended') await this.ctx.resume();
    } else if (this.ctx.state === 'running') {
      await this.ctx.suspend();
    }
  }

  private ensureAlive(): void {
    if (this.disposed) throw new Error('audio: AudioRuntime disposed');
  }
}

function defaultVisibility(): VisibilityTarget | null {
  if (typeof document === 'undefined') return null;
  return document;
}

function defaultGestureTarget(): GestureTarget | null {
  if (typeof window === 'undefined') return null;
  return window;
}
