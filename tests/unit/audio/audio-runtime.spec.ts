import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';
import { AudioRuntime } from '../../../src/audio/context';
import { Mixer } from '../../../src/audio/mixer';
import { AudioPolicy } from '../../../src/audio/policy';
import { MUTE_RAMP_SEC, VOICE_CAP, DEFAULT_AUDIO_PREFS } from '../../../src/audio/types';
import {
  FakeAudioContext,
  FakeGestureTarget,
  FakeVisibility,
  MemoryStorage,
} from './fakes';

const AUDIO_EXTS = new Set(['.mp3', '.wav', '.ogg', '.m4a', '.flac', '.aiff', '.aac', '.opus']);
const ASSET_RE = /\.(mp3|wav|ogg|m4a|flac|aiff|aac|opus)(["'`]|$)/i;

describe('AudioRuntime (P3-B-1)', () => {
  it('does not create an AudioContext before a user gesture', async () => {
    let creations = 0;
    const visibility = new FakeVisibility();
    const gestures = new FakeGestureTarget();
    const runtime = new AudioRuntime({
      createContext: () => {
        creations += 1;
        return new FakeAudioContext();
      },
      visibility,
      gestureTarget: gestures,
    });

    expect(runtime.getContext()).toBeNull();
    expect(runtime.isUnlocked()).toBe(false);
    expect(creations).toBe(0);

    await runtime.dispose();
    expect(creations).toBe(0);
  });

  it('unlocks on the first gesture and creates exactly one context', async () => {
    let creations = 0;
    const fake = new FakeAudioContext();
    const gestures = new FakeGestureTarget();
    const visibility = new FakeVisibility();
    const runtime = new AudioRuntime({
      createContext: () => {
        creations += 1;
        return fake;
      },
      visibility,
      gestureTarget: gestures,
    });

    gestures.fire('pointerdown');
    await vi.waitFor(() => expect(runtime.isUnlocked()).toBe(true));

    expect(creations).toBe(1);
    expect(runtime.getContext()).toBe(fake);
    expect(fake.resumeCount).toBeGreaterThanOrEqual(1);
    expect(fake.state).toBe('running');
    // Gesture listeners removed after unlock.
    expect(gestures.listenerCount('pointerdown')).toBe(0);

    await runtime.dispose();
  });

  it('suspends on tab hide and resumes on unhide', async () => {
    const fake = new FakeAudioContext();
    const visibility = new FakeVisibility();
    const runtime = new AudioRuntime({
      createContext: () => fake,
      visibility,
      gestureTarget: null,
      autoBindGestures: false,
    });

    await runtime.unlock();
    expect(fake.state).toBe('running');

    visibility.setHidden(true);
    await vi.waitFor(() => expect(fake.state).toBe('suspended'));
    expect(fake.suspendCount).toBeGreaterThanOrEqual(1);

    visibility.setHidden(false);
    await vi.waitFor(() => expect(fake.state).toBe('running'));

    await runtime.dispose();
  });

  it('suspends on simulation pause and resumes when play resumes', async () => {
    const fake = new FakeAudioContext();
    const visibility = new FakeVisibility();
    const runtime = new AudioRuntime({
      createContext: () => fake,
      visibility,
      gestureTarget: null,
      autoBindGestures: false,
    });

    await runtime.unlock();
    runtime.setSimulationPaused(true);
    await vi.waitFor(() => expect(fake.state).toBe('suspended'));

    runtime.setSimulationPaused(false);
    await vi.waitFor(() => expect(fake.state).toBe('running'));

    await runtime.dispose();
  });

  it('stays suspended while both paused and hidden, then resumes when both clear', async () => {
    const fake = new FakeAudioContext();
    const visibility = new FakeVisibility();
    const runtime = new AudioRuntime({
      createContext: () => fake,
      visibility,
      gestureTarget: null,
      autoBindGestures: false,
    });

    await runtime.unlock();
    runtime.setSimulationPaused(true);
    visibility.setHidden(true);
    await vi.waitFor(() => expect(fake.state).toBe('suspended'));

    runtime.setSimulationPaused(false);
    expect(fake.state).toBe('suspended');

    visibility.setHidden(false);
    await vi.waitFor(() => expect(fake.state).toBe('running'));

    await runtime.dispose();
  });

  it('returns false when the context factory throws', async () => {
    const runtime = new AudioRuntime({
      createContext: () => {
        throw new Error('no audio');
      },
      visibility: null,
      gestureTarget: null,
      autoBindGestures: false,
    });
    expect(await runtime.unlock()).toBe(false);
    expect(runtime.isUnlocked()).toBe(false);
    await runtime.dispose();
  });

  it('uses the browser AudioContext constructor when no factory is injected', async () => {
    const fake = new FakeAudioContext();
    const Prev = (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { AudioContext?: unknown }).AudioContext = class {
      constructor() {
        return fake;
      }
    };
    try {
      const runtime = new AudioRuntime({
        visibility: null,
        gestureTarget: null,
        autoBindGestures: false,
      });
      expect(await runtime.unlock()).toBe(true);
      expect(runtime.getContext()).toBe(fake);
      expect(runtime.contextCreationCount).toBe(1);
      expect(runtime.isSimulationPaused()).toBe(false);
      expect(runtime.isDocumentHidden()).toBe(false);
      await runtime.dispose();
      await runtime.dispose(); // idempotent
    } finally {
      if (Prev) (globalThis as { AudioContext?: unknown }).AudioContext = Prev;
      else delete (globalThis as { AudioContext?: unknown }).AudioContext;
    }
  });

  it('throws when AudioContext is missing and no factory is injected', async () => {
    const Prev = (globalThis as { AudioContext?: unknown }).AudioContext;
    const PrevWebkit = (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    delete (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
    try {
      const runtime = new AudioRuntime({
        visibility: null,
        gestureTarget: null,
        autoBindGestures: false,
      });
      expect(await runtime.unlock()).toBe(false);
      await runtime.dispose();
    } finally {
      if (Prev) (globalThis as { AudioContext?: unknown }).AudioContext = Prev;
      if (PrevWebkit) {
        (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext = PrevWebkit;
      }
    }
  });

  it('resolves default visibility/gesture targets in a DOM-like global', async () => {
    const fake = new FakeAudioContext();
    const visibility = new FakeVisibility();
    const gestures = new FakeGestureTarget();
    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevWin = (globalThis as { window?: unknown }).window;
    (globalThis as { document?: unknown }).document = visibility;
    (globalThis as { window?: unknown }).window = gestures;
    try {
      const runtime = new AudioRuntime({
        createContext: () => fake,
        // leave visibility/gestureTarget undefined so defaults run
      });
      expect(gestures.listenerCount('pointerdown')).toBe(1);
      await runtime.unlock();
      expect(fake.state).toBe('running');
      await runtime.dispose();
    } finally {
      if (prevDoc === undefined) delete (globalThis as { document?: unknown }).document;
      else (globalThis as { document?: unknown }).document = prevDoc;
      if (prevWin === undefined) delete (globalThis as { window?: unknown }).window;
      else (globalThis as { window?: unknown }).window = prevWin;
    }
  });

  it('swallows close errors on dispose and rejects use after dispose', async () => {
    const fake = new FakeAudioContext();
    fake.close = () => Promise.reject(new Error('already closed'));
    const runtime = new AudioRuntime({
      createContext: () => fake,
      visibility: null,
      gestureTarget: null,
      autoBindGestures: false,
    });
    await runtime.unlock();
    await runtime.dispose();
    expect(() => runtime.setSimulationPaused(true)).toThrow(/disposed/);
  });

  it('skips redundant resume/suspend when state already matches', async () => {
    const fake = new FakeAudioContext();
    const visibility = new FakeVisibility();
    const runtime = new AudioRuntime({
      createContext: () => fake,
      visibility,
      gestureTarget: null,
      autoBindGestures: false,
    });
    await runtime.unlock();
    const resumes = fake.resumeCount;
    await runtime.unlock(); // already running — no extra resume
    expect(fake.resumeCount).toBe(resumes);

    visibility.setHidden(true);
    await vi.waitFor(() => expect(fake.state).toBe('suspended'));
    const suspends = fake.suspendCount;
    runtime.setSimulationPaused(true); // still should not run — already suspended
    await Promise.resolve();
    expect(fake.suspendCount).toBe(suspends);

    await runtime.dispose();
  });

  it('falls back to webkitAudioContext when AudioContext is absent', async () => {
    const fake = new FakeAudioContext();
    const Prev = (globalThis as { AudioContext?: unknown }).AudioContext;
    const PrevWebkit = (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
    delete (globalThis as { AudioContext?: unknown }).AudioContext;
    (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext = class {
      constructor() {
        return fake;
      }
    };
    try {
      const runtime = new AudioRuntime({
        visibility: null,
        gestureTarget: null,
        autoBindGestures: false,
      });
      expect(await runtime.unlock()).toBe(true);
      await runtime.dispose();
    } finally {
      if (Prev) (globalThis as { AudioContext?: unknown }).AudioContext = Prev;
      else delete (globalThis as { AudioContext?: unknown }).AudioContext;
      if (PrevWebkit) {
        (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext = PrevWebkit;
      } else {
        delete (globalThis as { webkitAudioContext?: unknown }).webkitAudioContext;
      }
    }
  });

  it('defaults visibility and gesture to null when document/window are absent', async () => {
    const fake = new FakeAudioContext();
    const prevDoc = (globalThis as { document?: unknown }).document;
    const prevWin = (globalThis as { window?: unknown }).window;
    delete (globalThis as { document?: unknown }).document;
    delete (globalThis as { window?: unknown }).window;
    try {
      const runtime = new AudioRuntime({
        createContext: () => fake,
        autoBindGestures: false,
      });
      expect(await runtime.unlock()).toBe(true);
      expect(runtime.isDocumentHidden()).toBe(false);
      await runtime.dispose();
    } finally {
      if (prevDoc !== undefined) (globalThis as { document?: unknown }).document = prevDoc;
      if (prevWin !== undefined) (globalThis as { window?: unknown }).window = prevWin;
    }
  });
});

describe('Mixer (P3-B-1)', () => {
  it('wires ambient + event → master → limiter → destination', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });

    expect(ctx.createGainCount).toBe(3);
    expect(ctx.createCompressorCount).toBe(1);
    const ambient = mixer.ambient as unknown as { connections: unknown[] };
    const event = mixer.event as unknown as { connections: unknown[] };
    const master = mixer.master as unknown as { connections: unknown[] };
    const limiter = mixer.limiter as unknown as { connections: unknown[] };
    expect(ambient.connections).toContain(mixer.master);
    expect(event.connections).toContain(mixer.master);
    expect(master.connections).toContain(mixer.limiter);
    expect(limiter.connections).toContain(ctx.destination);

    mixer.dispose();
  });

  it('mutes with a short linear ramp (no hard click)', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 1.5;
    const mixer = new Mixer({ context: ctx, masterGain: 0.7 });
    const gain = mixer.master.gain as unknown as {
      events: { kind: string; value?: number; time: number }[];
      value: number;
    };
    gain.events.length = 0;

    mixer.setMuted(true);

    expect(mixer.isMuted).toBe(true);
    const kinds = gain.events.map((e) => e.kind);
    expect(kinds).toContain('cancel');
    expect(kinds).toContain('linear');
    const ramp = gain.events.find((e) => e.kind === 'linear');
    expect(ramp?.value).toBe(0);
    expect(ramp?.time).toBeCloseTo(1.5 + MUTE_RAMP_SEC, 5);
    expect(gain.value).toBe(0);

    mixer.dispose();
  });

  it('unmute restores the remembered master level with a ramp', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 2;
    const mixer = new Mixer({ context: ctx, masterGain: 0.55 });
    mixer.setMuted(true);
    ctx.currentTime = 3;
    const gain = mixer.master.gain as unknown as {
      events: { kind: string; value?: number; time: number }[];
    };
    gain.events.length = 0;

    mixer.setMuted(false);
    const ramp = gain.events.find((e) => e.kind === 'linear');
    expect(ramp?.value).toBe(0.55);
    expect(ramp?.time).toBeCloseTo(3 + MUTE_RAMP_SEC, 5);

    mixer.dispose();
  });

  it('clamps bus levels to [0, 1] and ramps ambient/event', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    mixer.setAmbientLevel(2);
    mixer.setEventLevel(-1);
    expect(mixer.getAmbientLevel()).toBe(1);
    expect(mixer.getEventLevel()).toBe(0);
    expect(mixer.bus('ambient')).toBe(mixer.ambient);
    expect(mixer.bus('event')).toBe(mixer.event);
    mixer.dispose();
  });

  it('setMasterLevel ramps when unmuted and remembers level while muted', () => {
    const ctx = new FakeAudioContext();
    ctx.currentTime = 0;
    const mixer = new Mixer({ context: ctx, masterGain: 0.5 });
    expect(mixer.getMasterLevel()).toBe(0.5);
    expect(mixer.isMuted).toBe(false);

    mixer.setMasterLevel(0.9);
    expect(mixer.getMasterLevel()).toBe(0.9);

    mixer.setMuted(true);
    mixer.setMasterLevel(0.2);
    expect(mixer.getMasterLevel()).toBe(0.2);
    // still muted — gain stays at 0 until unmute
    expect(mixer.master.gain.value).toBe(0);

    mixer.setMuted(true); // no-op when already muted
    mixer.setMuted(false);
    expect(mixer.master.gain.value).toBe(0.2);

    mixer.dispose();
    expect(() => mixer.setMuted(false)).toThrow(/disposed/);
    mixer.dispose(); // idempotent
  });

  it('applies zero-ramp setValueAtTime when rampSec is 0 (constructor path)', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({
      context: ctx,
      masterGain: Number.NaN,
      ambientGain: -5,
      eventGain: 99,
    });
    expect(mixer.getMasterLevel()).toBe(0);
    expect(mixer.getAmbientLevel()).toBe(0);
    expect(mixer.getEventLevel()).toBe(1);
    mixer.dispose();
  });

  it('swallows disconnect errors on dispose', () => {
    const ctx = new FakeAudioContext();
    const mixer = new Mixer({ context: ctx });
    mixer.master.disconnect = () => {
      throw new Error('gone');
    };
    expect(() => mixer.dispose()).not.toThrow();
  });
});

describe('AudioPolicy (P3-B-1)', () => {
  it('starts muted by default and persists mute + volume', () => {
    const storage = new MemoryStorage();
    const policy = new AudioPolicy({ storage, reducedMotion: () => false });

    expect(policy.isMuted()).toBe(true);
    expect(policy.getPrefs().muted).toBe(DEFAULT_AUDIO_PREFS.muted);

    policy.setMuted(false);
    policy.setMasterVolume(0.4);

    const again = new AudioPolicy({ storage, reducedMotion: () => false });
    expect(again.isMuted()).toBe(false);
    expect(again.getPrefs().masterVolume).toBe(0.4);
  });

  it('silences ambient under reduced motion; events still allowed when unmuted', () => {
    const policy = new AudioPolicy({
      storage: null,
      reducedMotion: () => true,
      prefs: { muted: false },
    });
    expect(policy.canPlayAmbient()).toBe(false);
    expect(policy.canPlayEvent()).toBe(true);
  });

  it('enforces the 24-voice cap with oldest-first stealing', () => {
    const policy = new AudioPolicy({ storage: null, reducedMotion: () => false });
    expect(policy.voiceCap).toBe(VOICE_CAP);

    const ids: number[] = [];
    for (let i = 0; i < VOICE_CAP; i++) {
      ids.push(policy.allocateVoice(i).id);
    }
    expect(policy.liveVoiceCount).toBe(VOICE_CAP);

    const next = policy.allocateVoice(1000);
    expect(next.stealId).toBe(ids[0]);
    expect(policy.liveVoiceCount).toBe(VOICE_CAP);

    policy.releaseVoice(next.id);
    expect(policy.liveVoiceCount).toBe(VOICE_CAP - 1);
  });

  it('degrades when storage throws', () => {
    const storage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('quota');
      },
    };
    const policy = new AudioPolicy({ storage, reducedMotion: () => false });
    expect(() => policy.setMuted(false)).not.toThrow();
    expect(policy.isMuted()).toBe(false);
  });

  it('persists ambient and event volumes and ignores corrupt storage', () => {
    const storage = new MemoryStorage();
    storage.setItem('gol.audio', '{not-json');
    const bad = new AudioPolicy({ storage, reducedMotion: () => false });
    expect(bad.isMuted()).toBe(true);

    storage.setItem(
      'gol.audio',
      JSON.stringify({ muted: false, masterVolume: 2, ambientVolume: 'x', eventVolume: 0.3 }),
    );
    const policy = new AudioPolicy({ storage, reducedMotion: () => false });
    expect(policy.isMuted()).toBe(false);
    expect(policy.getPrefs().masterVolume).toBe(1);
    expect(policy.getPrefs().eventVolume).toBe(0.3);

    policy.setAmbientVolume(-1);
    policy.setEventVolume(1.5);
    expect(policy.getPrefs().ambientVolume).toBe(0);
    expect(policy.getPrefs().eventVolume).toBe(1);
  });

  it('uses system reduced-motion query when none is injected', () => {
    const prev = (globalThis as { matchMedia?: unknown }).matchMedia;
    (globalThis as { matchMedia?: unknown }).matchMedia = (q: string) => ({
      matches: q.includes('reduce'),
    });
    try {
      const policy = new AudioPolicy({ storage: null, prefs: { muted: false } });
      expect(policy.canPlayAmbient()).toBe(false);
      expect(policy.canPlayEvent()).toBe(true);
    } finally {
      if (prev) (globalThis as { matchMedia?: unknown }).matchMedia = prev;
      else delete (globalThis as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('probes realAudioStorage without throwing in node', async () => {
    const { realAudioStorage } = await import('../../../src/audio/policy');
    // jsdom-less node: either null or a working localStorage stub.
    const store = realAudioStorage();
    expect(store === null || typeof store.getItem === 'function').toBe(true);
  });

  it('returns a working storage when localStorage accepts the probe', async () => {
    const { realAudioStorage } = await import('../../../src/audio/policy');
    const mem = new MemoryStorage();
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: Storage }).localStorage = mem as unknown as Storage;
    try {
      const store = realAudioStorage();
      expect(store).not.toBeNull();
      store!.setItem('k', 'v');
      expect(store!.getItem('k')).toBe('v');
    } finally {
      if (prev === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });

  it('returns null when localStorage probe throws', async () => {
    const { realAudioStorage } = await import('../../../src/audio/policy');
    const prev = (globalThis as { localStorage?: unknown }).localStorage;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('denied');
      },
      removeItem: () => undefined,
    };
    try {
      expect(realAudioStorage()).toBeNull();
    } finally {
      if (prev === undefined) delete (globalThis as { localStorage?: unknown }).localStorage;
      else (globalThis as { localStorage?: unknown }).localStorage = prev;
    }
  });

  it('treats missing matchMedia as no reduced motion', () => {
    const prev = (globalThis as { matchMedia?: unknown }).matchMedia;
    delete (globalThis as { matchMedia?: unknown }).matchMedia;
    try {
      const policy = new AudioPolicy({ storage: null, prefs: { muted: false } });
      expect(policy.canPlayAmbient()).toBe(true);
    } finally {
      if (prev !== undefined) (globalThis as { matchMedia?: unknown }).matchMedia = prev;
    }
  });

  it('silences everything when muted', () => {
    const policy = new AudioPolicy({
      storage: null,
      reducedMotion: () => false,
      prefs: { muted: true },
    });
    expect(policy.canPlayAmbient()).toBe(false);
    expect(policy.canPlayEvent()).toBe(false);
  });
});

describe('zero audio assets (P3-B-1)', () => {
  it('ships no audio files under src/audio and no asset string literals', () => {
    const root = join(process.cwd(), 'src/audio');
    const files = walkFiles(root);
    for (const file of files) {
      expect(AUDIO_EXTS.has(extname(file).toLowerCase())).toBe(false);
      if (file.endsWith('.ts')) {
        const src = readFileSync(file, 'utf8');
        expect(ASSET_RE.test(src)).toBe(false);
      }
    }
  });

  it('leaves zero audio files in dist/ when a build is present', () => {
    const dist = join(process.cwd(), 'dist');
    if (!existsSync(dist)) return;
    const offenders = walkFiles(dist).filter((f) => AUDIO_EXTS.has(extname(f).toLowerCase()));
    expect(offenders).toEqual([]);
  });
});

function walkFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walkFiles(full));
    else out.push(full);
  }
  return out;
}
