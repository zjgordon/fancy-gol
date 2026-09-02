import { describe, expect, it } from 'vitest';
import { CHUNK_AREA, localIndex, packCell, packChunk } from '@engine/grid/coords';
import { HistoryJournal, type HistoryEviction } from '@engine/history/journal';
import type { ChangeSet, Snapshot } from '@engine/types';

function emptySnap(tick = 0, rngState = 0): Snapshot {
  return {
    tick,
    chunkKeys: new Int32Array(0),
    chunkData: new Uint8Array(0),
    rngState,
  };
}

function emptyDelta(tick: number): ChangeSet {
  return {
    tick,
    coords: new Int32Array(0),
    from: new Uint8Array(0),
    to: new Uint8Array(0),
    count: 0,
    dirtyChunks: new Int32Array(0),
  };
}

describe('HistoryJournal construction', () => {
  it('rejects a non-positive keyframe interval or byte ceiling', () => {
    expect(() => new HistoryJournal({ keyframeInterval: 0 })).toThrow(/keyframeInterval/);
    expect(() => new HistoryJournal({ byteCeiling: 0 })).toThrow(/byteCeiling/);
  });

  it('reports an empty retained range before the first keyframe', () => {
    const journal = new HistoryJournal();
    expect(journal.retained).toEqual({ from: 0, to: 0 });
    expect(journal.eviction).toBeUndefined();
    expect(() => journal.materialize(0)).toThrow(/empty/);
    journal.resetTo(emptySnap(0), 0);
    expect(() => journal.materialize(1)).toThrow(/outside the retained window/);
    expect(() => journal.materialize(-1)).toThrow(/outside the retained window/);
  });
});

describe('HistoryJournal copy-on-ingest', () => {
  it('stores a copy of the ChangeSet so later mutation of the reused buffers cannot rewrite history', () => {
    const journal = new HistoryJournal();
    journal.resetTo(emptySnap(0), 0);
    const coords = new Int32Array([packCell(3, 4)]);
    const from = new Uint8Array([0]);
    const to = new Uint8Array([1]);
    journal.recordDelta(
      { tick: 1, coords, from, to, count: 1, dirtyChunks: new Int32Array(0) },
      99,
    );
    coords[0] = packCell(0, 0);
    from[0] = 9;
    to[0] = 9;

    const snap = journal.materialize(1);
    expect(snap.tick).toBe(1);
    expect(snap.rngState).toBe(99);
    expect(snap.chunkKeys).toEqual(new Int32Array([packChunk(0, 0)]));
    expect(snap.chunkData[localIndex(3, 4)]).toBe(1);
    expect(snap.chunkData[localIndex(0, 0)]).toBe(0);
  });

  it('compacts a page that deltas empty out', () => {
    const journal = new HistoryJournal();
    const keys = new Int32Array([packChunk(0, 0)]);
    const data = new Uint8Array(CHUNK_AREA);
    data[localIndex(3, 4)] = 1;
    journal.resetTo({ tick: 0, chunkKeys: keys, chunkData: data, rngState: 0 }, 1);
    journal.recordDelta(
      {
        tick: 1,
        coords: new Int32Array([packCell(3, 4)]),
        from: new Uint8Array([1]),
        to: new Uint8Array([0]),
        count: 1,
        dirtyChunks: new Int32Array(0),
      },
      0,
    );
    const snap = journal.materialize(1);
    expect(snap.chunkKeys.length).toBe(0);
    expect(snap.chunkData.length).toBe(0);
  });
});

describe('HistoryJournal truncateAfter', () => {
  it('drops later keyframes and deltas and reports the byte drop', () => {
    const journal = new HistoryJournal({ keyframeInterval: 64 });
    journal.resetTo(emptySnap(0), 0);
    for (let t = 1; t <= 192; t++) {
      journal.recordDelta(emptyDelta(t), t);
      if (t % 64 === 0) journal.recordKeyframe(emptySnap(t, t), 0);
    }
    const before = journal.bytes;
    expect(journal.retained).toEqual({ from: 0, to: 192 });

    journal.truncateAfter(64);
    expect(journal.bytes).toBeLessThan(before);
    expect(journal.retained).toEqual({ from: 0, to: 64 });
    expect(journal.materialize(64).tick).toBe(64);
    expect(() => journal.materialize(65)).toThrow(/outside the retained window/);

    const heapBefore = process.memoryUsage().heapUsed;
    const fat = new HistoryJournal();
    const keys = new Int32Array([packChunk(0, 0)]);
    const data = new Uint8Array(CHUNK_AREA);
    data.fill(1);
    const fatSnap = (tick: number): Snapshot => ({
      tick,
      chunkKeys: keys,
      chunkData: data,
      rngState: 0,
    });
    fat.resetTo(fatSnap(0), CHUNK_AREA);
    for (let t = 64; t <= 256; t += 64) fat.recordKeyframe(fatSnap(t), CHUNK_AREA);
    const fatBefore = fat.bytes;
    fat.truncateAfter(0);
    expect(fat.bytes).toBeLessThan(fatBefore);
    const gc = (globalThis as { gc?: () => void }).gc;
    if (typeof gc === 'function') {
      gc();
      expect(process.memoryUsage().heapUsed).toBeLessThan(heapBefore + fatBefore);
    }
  });
});

describe('HistoryJournal eviction', () => {
  it('evicts the oldest keyframe and its deltas first, emits the event, and stays under the ceiling', () => {
    const reports: HistoryEviction[] = [];
    const journal = new HistoryJournal({
      keyframeInterval: 1,
      byteCeiling: 80,
      onEvict: (e) => reports.push(e),
    });
    journal.resetTo(emptySnap(0), 0);
    for (let t = 1; t <= 24; t++) {
      journal.recordDelta(emptyDelta(t), t);
      journal.recordKeyframe(emptySnap(t, t), 0);
    }
    expect(journal.bytes).toBeLessThanOrEqual(80);
    expect(journal.evictions).toBeGreaterThan(0);
    expect(reports.length).toBe(journal.evictions);
    expect(reports[0]!.discardedFrom).toBe(0);
    expect(reports[0]!.bytesFreed).toBeGreaterThan(0);
    expect(journal.eviction).toEqual(reports[reports.length - 1]);
    expect(journal.retained.from).toBe(reports[reports.length - 1]!.retainedFrom);
    expect(() => journal.materialize(0)).toThrow(/outside the retained window/);
    expect(journal.materialize(journal.retained.to).tick).toBe(journal.retained.to);
  });
});
