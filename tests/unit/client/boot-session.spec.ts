import { afterEach, describe, expect, it, vi } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import type { SessionDoc } from '@shared/session';
import { resolveBootSession } from '@client/boot-session';
import * as session from '@client/session';

const RESTORED = {
  ruleset: CONWAY,
  paintOps: [],
  tick: 4,
  seed: 1,
  camera: { originX: 0, originY: 0, cellSize: 8 },
  theme: 'default',
  activeToolId: 'brush',
} as const;

function minimalDoc(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 1, y = 1\no!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('resolveBootSession', () => {
  it('returns null when there is no share fragment and no autosave', async () => {
    vi.spyOn(session, 'loadSession').mockReturnValue(null);
    const restored = await resolveBootSession({
      hash: '',
      testMode: true,
      confirmOverwrite: () => false,
      fetchServerSession: () => Promise.resolve(null),
    });
    expect(restored).toBeNull();
  });

  it('applies a share fragment and skips confirm in test mode', async () => {
    const doc = minimalDoc({ tick: 9 });
    vi.spyOn(session, 'loadSession').mockReturnValue(minimalDoc());
    vi.spyOn(session, 'resolveShareFragment').mockImplementation(async (_hash, opts) => {
      const proceed = await opts.confirmOverwrite();
      expect(proceed).toBe(true);
      const raw = await opts.fetchServerSession?.('id');
      expect(raw).toEqual(doc);
      return doc;
    });
    const apply = vi.spyOn(session, 'applySessionDoc').mockReturnValue(RESTORED);
    const restored = await resolveBootSession({
      hash: '#s:cFcZvYY9yg8',
      testMode: true,
      confirmOverwrite: () => false,
      fetchServerSession: () => Promise.resolve(doc),
    });
    expect(apply).toHaveBeenCalledWith(doc);
    expect(restored).toEqual(RESTORED);
  });

  it('asks before overwrite outside test mode and swallows a corrupt share', async () => {
    const doc = minimalDoc();
    vi.spyOn(session, 'loadSession').mockReturnValue(doc);
    vi.spyOn(session, 'resolveShareFragment').mockImplementation(async (_hash, opts) => {
      expect(await opts.confirmOverwrite()).toBe(false);
      return doc;
    });
    vi.spyOn(session, 'applySessionDoc').mockImplementation(() => {
      throw new RangeError('bad');
    });
    const restored = await resolveBootSession({
      hash: '#d:abc',
      testMode: false,
      confirmOverwrite: () => false,
      fetchServerSession: () => Promise.resolve(null),
    });
    expect(restored).toBeNull();
  });

  it('falls through to autosave when the fragment is empty', async () => {
    const doc = minimalDoc({ tick: 3 });
    vi.spyOn(session, 'loadSession').mockReturnValue(doc);
    vi.spyOn(session, 'resolveShareFragment').mockResolvedValue(null);
    vi.spyOn(session, 'applySessionDoc').mockReturnValue(RESTORED);
    const restored = await resolveBootSession({
      hash: '',
      testMode: false,
      confirmOverwrite: () => true,
      fetchServerSession: () => Promise.resolve(null),
    });
    expect(restored).toEqual(RESTORED);
  });

  it('treats a missing server session as no share document', async () => {
    vi.spyOn(session, 'loadSession').mockReturnValue(null);
    vi.spyOn(session, 'resolveShareFragment').mockImplementation(async (_hash, opts) => {
      const raw = await opts.fetchServerSession?.('missing');
      expect(raw).toBeNull();
      return raw ?? null;
    });
    const restored = await resolveBootSession({
      hash: '#s:missing',
      testMode: true,
      confirmOverwrite: () => true,
      fetchServerSession: () => Promise.resolve(null),
    });
    expect(restored).toBeNull();
  });

  it('swallows a corrupt autosave', async () => {
    vi.spyOn(session, 'loadSession').mockReturnValue(minimalDoc());
    vi.spyOn(session, 'resolveShareFragment').mockResolvedValue(null);
    vi.spyOn(session, 'applySessionDoc').mockImplementation(() => {
      throw new RangeError('bad');
    });
    const restored = await resolveBootSession({
      hash: '',
      testMode: false,
      confirmOverwrite: () => true,
      fetchServerSession: () => Promise.resolve(null),
    });
    expect(restored).toBeNull();
  });
});
