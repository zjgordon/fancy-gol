/**
 * `StatsCollector` — population, per-state counts, births, deaths,
 * transitions and per-tick activity, maintained in O(changes) from the
 * `ChangeSet` stream a `Simulation` already produces. Per ADR-007, the delta
 * stream is exactly the data the stat engine needs; this collector never
 * re-scans the grid to answer "what changed."
 *
 * `reset` is the one O(cells) pass a collector ever takes — it seeds a
 * baseline (from a fresh grid, a restored snapshot, a `seedRandom` call, a
 * pattern stamped in with raw `set`s, …) that every subsequent `apply` call
 * can then update incrementally, independent of grid size.
 */
import { CHUNK_AREA } from '../grid/coords';
import { DEAD, type ChangeSet, type GridView } from '../types';

/** A `StateId` is a grid byte; 256 slots always fits the palette. */
const STATE_SLOTS = 256;

/** The counters a `StatsCollector` maintains. Mutated in place — copy `perState` if you need to keep a tick's values past the next `apply`/`reset`. */
export interface CollectorStats {
  tick: number;
  population: number;
  readonly perState: Uint32Array;
  /** Cells born (a `DEAD` cell became live) this tick. */
  births: number;
  /** Cells that died (a live cell became `DEAD`) this tick. */
  deaths: number;
  /** Cells that changed between two non-`DEAD` states this tick. */
  transitions: number;
  /** Cells changed this tick — the `ChangeSet.count` this collector last folded in. */
  activity: number;
}

export class StatsCollector {
  private readonly stats: CollectorStats = {
    tick: 0,
    population: 0,
    perState: new Uint32Array(STATE_SLOTS),
    births: 0,
    deaths: 0,
    transitions: 0,
    activity: 0,
  };

  get snapshot(): Readonly<CollectorStats> {
    return this.stats;
  }

  /**
   * Seed the running counters from a full grid scan via the public
   * `GridView` surface. Call once at construction, and again after anything
   * that isn't itself a `ChangeSet` — `restore`, a fresh `seedRandom`, cells
   * stamped in with raw `set` calls.
   */
  reset(view: GridView, tick = 0): void {
    const s = this.stats;
    s.perState.fill(0);
    let population = 0;
    const bounds = view.bounds();
    if (bounds.width > 0 && bounds.height > 0) {
      view.forEachChunkInRect(bounds, (chunk) => {
        population += chunk.population;
        for (let i = 0; i < CHUNK_AREA; i++) {
          const st = chunk.at(i);
          s.perState[st] = (s.perState[st] ?? 0) + 1;
        }
      });
    }
    s.population = population;
    s.tick = tick;
    s.births = 0;
    s.deaths = 0;
    s.transitions = 0;
    s.activity = 0;
  }

  /**
   * Fold one `ChangeSet` into the running counters — O(`cs.count`), never a
   * grid scan. `births`/`deaths`/`transitions`/`activity` describe this
   * `ChangeSet` only (they are reset, not accumulated); `population` and
   * `perState` keep a running total across every `apply` since the last
   * `reset`.
   */
  apply(cs: ChangeSet): void {
    const s = this.stats;
    const { from, to, count } = cs;
    const perState = s.perState;
    let population = s.population;
    let births = 0;
    let deaths = 0;
    let transitions = 0;

    for (let i = 0; i < count; i++) {
      const f = from[i]!;
      const t = to[i]!;
      if (f === t) continue;
      perState[f]!--;
      perState[t]!++;
      if (f === DEAD) {
        population += 1;
        births += 1;
      } else if (t === DEAD) {
        population -= 1;
        deaths += 1;
      } else {
        transitions += 1;
      }
    }

    s.population = population;
    s.births = births;
    s.deaths = deaths;
    s.transitions = transitions;
    s.activity = count;
    s.tick = cs.tick;
  }
}
