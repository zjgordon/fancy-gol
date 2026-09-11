/**
 * Cycle detection on top of {@link ZobristHasher} (P2-C-3).
 *
 * A `hash + population` repeat is only a *candidate*. Confirmation walks
 * two `HistoryJournal.materialize` snapshots (ADR-007) and compares live
 * cells — never report a cycle from the hash alone. 32-bit collisions
 * happen; exact comparison is what keeps chaotic soups at zero false
 * positives.
 *
 * Three kinds, first match wins by priority:
 *
 * 1. **oscillator** — absolute hash repeats and the snapshots are equal.
 *    Blinker p2, pulsar p3, pentadecathlon p15, still lifes p1.
 * 2. **spaceship** — shape hash repeats and snapshot T equals snapshot
 *    T−p translated by the bbox-origin delta. A glider is p4, (1,1).
 * 3. **windowed** — the frozen core-window hash repeats and the live
 *    cells *inside that window* match. Gosper's gun is p30 this way:
 *    emitted gliders leave the pad and stop defeating the period.
 *
 * Windowing (documented, asserted by the gun test): the live bounding
 * box at `ZobristHasher.reset`, expanded by {@link WINDOW_PAD} (8) cells,
 * then frozen in world space. After the first outbound glider has left
 * the pad (~32 gens at c/4), window contents are the gun mechanism plus
 * at most the in-production glider at the same phase. Population 0
 * inside the window is not a cycle — the pattern left.
 *
 * Without a `materialize` callback the detector records candidates and
 * never emits a report. Each detector owns its own maps; two collectors
 * share nothing mutable.
 */
import { CHUNK_AREA, CHUNK_SIZE, unpackChunkX, unpackChunkY } from '../grid/coords.js';
import { DEAD, type Rect, type Snapshot, type StateId } from '../types.js';
import { inRect, WINDOW_PAD } from './zobrist.js';

export { WINDOW_PAD };

export type CycleKind = 'oscillator' | 'spaceship' | 'windowed';

export interface CycleReport {
  readonly kind: CycleKind;
  readonly period: number;
  readonly detectedAt: number;
  readonly previousTick: number;
  readonly displacement: { readonly x: number; readonly y: number };
}

export interface CycleObserveInput {
  readonly tick: number;
  readonly population: number;
  readonly absHash: number;
  readonly shapeHash: number;
  readonly windowHash: number;
  readonly windowPop: number;
  readonly bbox: Rect;
  readonly core: Rect;
  readonly shapeValid: boolean;
  /** Reconstruct the grid at `t` from the history journal. */
  readonly materialize: (t: number) => Snapshot;
}

interface Seen {
  readonly tick: number;
  readonly bboxX: number;
  readonly bboxY: number;
}

const KIND_RANK: Record<CycleKind, number> = {
  oscillator: 0,
  spaceship: 1,
  windowed: 2,
};

function keyOf(hash: number, pop: number): string {
  return `${hash >>> 0}:${pop}`;
}

function better(next: CycleReport, prev: CycleReport): boolean {
  const dr = KIND_RANK[next.kind] - KIND_RANK[prev.kind];
  if (dr !== 0) return dr < 0;
  return next.period < prev.period;
}

export function forEachLiveInSnapshot(
  snap: Snapshot,
  fn: (x: number, y: number, state: StateId) => void,
): void {
  const keys = snap.chunkKeys;
  const data = snap.chunkData;
  for (let i = 0; i < keys.length; i++) {
    const packed = keys[i]!;
    const ox = unpackChunkX(packed) * CHUNK_SIZE;
    const oy = unpackChunkY(packed) * CHUNK_SIZE;
    const off = i * CHUNK_AREA;
    for (let li = 0; li < CHUNK_AREA; li++) {
      const s = data[off + li]!;
      if (s === DEAD) continue;
      fn(ox + (li & 31), oy + (li >>> 5), s);
    }
  }
}

function liveMap(snap: Snapshot): Map<string, StateId> {
  const map = new Map<string, StateId>();
  forEachLiveInSnapshot(snap, (x, y, s) => {
    map.set(`${x},${y}`, s);
  });
  return map;
}

export function snapshotsEqual(a: Snapshot, b: Snapshot): boolean {
  const ma = liveMap(a);
  const mb = liveMap(b);
  if (ma.size !== mb.size) return false;
  for (const [k, s] of ma) {
    if (mb.get(k) !== s) return false;
  }
  return true;
}

export function snapshotsEqualTranslated(a: Snapshot, b: Snapshot, dx: number, dy: number): boolean {
  const mb = liveMap(b);
  let n = 0;
  let ok = true;
  forEachLiveInSnapshot(a, (x, y, s) => {
    n += 1;
    if (mb.get(`${x + dx},${y + dy}`) !== s) ok = false;
  });
  return ok && n === mb.size;
}

export function snapshotsEqualInWindow(a: Snapshot, b: Snapshot, core: Rect): boolean {
  const ma = new Map<string, StateId>();
  const mb = new Map<string, StateId>();
  forEachLiveInSnapshot(a, (x, y, s) => {
    if (inRect(x, y, core)) ma.set(`${x},${y}`, s);
  });
  forEachLiveInSnapshot(b, (x, y, s) => {
    if (inRect(x, y, core)) mb.set(`${x},${y}`, s);
  });
  if (ma.size !== mb.size) return false;
  for (const [k, s] of ma) {
    if (mb.get(k) !== s) return false;
  }
  return true;
}

export class CycleDetector {
  private readonly absSeen = new Map<string, Seen>();
  private readonly shapeSeen = new Map<string, Seen>();
  private readonly windowSeen = new Map<string, Seen>();
  private report: CycleReport | null = null;

  get current(): CycleReport | null {
    return this.report;
  }

  reset(): void {
    this.absSeen.clear();
    this.shapeSeen.clear();
    this.windowSeen.clear();
    this.report = null;
  }

  observe(input: CycleObserveInput): CycleReport | null {
    const best = this.report;
    if (best && best.kind === 'oscillator' && best.period === 1) return best;

    const { tick, population, bbox } = input;
    if (population > 0) {
      this.consider(
        this.absSeen,
        keyOf(input.absHash, population),
        tick,
        bbox,
        'oscillator',
        (prev) => {
          const a = input.materialize(prev.tick);
          const b = input.materialize(tick);
          if (!snapshotsEqual(a, b)) return null;
          return {
            kind: 'oscillator',
            period: tick - prev.tick,
            detectedAt: tick,
            previousTick: prev.tick,
            displacement: { x: 0, y: 0 },
          };
        },
      );
    }

    if (population > 0 && input.shapeValid) {
      this.consider(
        this.shapeSeen,
        keyOf(input.shapeHash, population),
        tick,
        bbox,
        'spaceship',
        (prev) => {
          const dx = bbox.x - prev.bboxX;
          const dy = bbox.y - prev.bboxY;
          if (dx === 0 && dy === 0) return null;
          const a = input.materialize(prev.tick);
          const b = input.materialize(tick);
          if (!snapshotsEqualTranslated(a, b, dx, dy)) return null;
          return {
            kind: 'spaceship',
            period: tick - prev.tick,
            detectedAt: tick,
            previousTick: prev.tick,
            displacement: { x: dx, y: dy },
          };
        },
      );
    }

    if (input.windowPop > 0 && input.core.width > 0 && input.core.height > 0) {
      this.consider(
        this.windowSeen,
        keyOf(input.windowHash, input.windowPop),
        tick,
        bbox,
        'windowed',
        (prev) => {
          const a = input.materialize(prev.tick);
          const b = input.materialize(tick);
          if (!snapshotsEqualInWindow(a, b, input.core)) return null;
          return {
            kind: 'windowed',
            period: tick - prev.tick,
            detectedAt: tick,
            previousTick: prev.tick,
            displacement: { x: 0, y: 0 },
          };
        },
      );
    }

    return this.report;
  }

  private consider(
    map: Map<string, Seen>,
    key: string,
    tick: number,
    bbox: Rect,
    kind: CycleKind,
    confirm: (prev: Seen) => CycleReport | null,
  ): void {
    const prev = map.get(key);
    if (prev === undefined) {
      map.set(key, { tick, bboxX: bbox.x, bboxY: bbox.y });
      return;
    }
    const period = tick - prev.tick;
    if (period <= 0) return;
    const speculative: CycleReport = {
      kind,
      period,
      detectedAt: tick,
      previousTick: prev.tick,
      displacement: { x: 0, y: 0 },
    };
    if (this.report && !better(speculative, this.report)) return;
    let candidate: CycleReport | null;
    try {
      candidate = confirm(prev);
    } catch {
      return;
    }
    if (!candidate) return;
    if (!this.report || better(candidate, this.report)) this.report = candidate;
  }
}
