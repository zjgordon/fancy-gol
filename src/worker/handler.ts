/**
 * P0-G-2 — the transport-agnostic worker handler. Takes a `postMessage`-shaped function, not
 * a `self`: nothing here reaches for `self.onmessage`, `self.postMessage`, or any other
 * worker-global. That single choice is what makes the whole engine testable headlessly (an
 * in-memory port pair drives it in `tests/integration/worker-protocol.spec.ts`, no `Worker`,
 * no jsdom) and reusable in Phase 5's `OffscreenCanvas` move — `sim.worker.ts` (P0-G-3) is the
 * thin adapter that wires this to a real worker's globals.
 *
 * A `Command` never kills the handler: every dispatch is wrapped, and any thrown error —
 * `RuleValidationError`, a plain `RangeError`, whatever — becomes a structured `error` event
 * instead of an uncaught exception.
 */
import type { Clock } from '@engine/clock';
import { CHUNK_AREA, CHUNK_SIZE, chunkToWorld, unpackChunkX, unpackChunkY } from '@engine/grid/coords';
import { validateRuleSet } from '@engine/rules/validate';
import { Simulation } from '@engine/simulation';
import type { ChangeSet, Rect } from '@engine/types';
import { parseCommand, type Command, type Event, type TransferredChunks, type WorkerCaps } from '@shared/protocol';
import type { TickStats } from '@shared/types';

export type PostMessageFn = (event: Event, transfer?: readonly Transferable[]) => void;

/**
 * `run`'s free-run mode needs *something* that calls a function repeatedly at an interval —
 * injected so tests can advance the schedule instantly instead of waiting on real wall time.
 * `REAL_SCHEDULER` below is `sim.worker.ts`'s to opt into; this module never touches a global
 * timer on its own.
 */
export interface Scheduler {
  setInterval(fn: () => void, ms: number): number;
  clearInterval(id: number): void;
}

/** The real-timer `Scheduler`, for `sim.worker.ts` to pass in. Not used by this module itself. */
export const REAL_SCHEDULER: Scheduler = {
  setInterval: (fn, ms) => setInterval(fn, ms) as unknown as number,
  clearInterval: (id) => clearInterval(id),
};

export interface HandlerOptions {
  readonly post: PostMessageFn;
  readonly scheduler: Scheduler;
  /**
   * Echoed back on a successful `init` (the `ready` event). Detecting the *real* environment's
   * capabilities (is `SharedArrayBuffer` actually usable, is `OffscreenCanvas` supported) is
   * `sim.worker.ts`'s job — this module doesn't touch a single environment global.
   */
  readonly capabilities: WorkerCaps;
  /** Injected clock for `TickStats.stepMicros`; defaults to `Simulation`'s own zero-delta stub. */
  readonly clock?: Clock;
}

export interface WorkerHandler {
  /** Feed one incoming message (already `unknown` off the wire) to the handler. Never throws. */
  handle(raw: unknown): void;
}

function extractId(raw: unknown): number {
  if (typeof raw === 'object' && raw !== null && 'id' in raw) {
    const id = (raw as Record<string, unknown>)['id'];
    if (typeof id === 'number' && Number.isFinite(id)) return id;
  }
  return -1;
}

function copyStats(s: Readonly<TickStats>): TickStats {
  return {
    tick: s.tick,
    population: s.population,
    perState: s.perState.slice(),
    births: s.births,
    deaths: s.deaths,
    transitions: s.transitions,
    activeChunks: s.activeChunks,
    stepMicros: s.stepMicros,
  };
}

/** Copies every dirty chunk's live page into one transferable payload. Missing (reclaimed-empty) chunks stay all-`DEAD`, which is correct — a reclaimed chunk has no live cells left. */
function buildTransferredChunks(sim: Simulation, dirtyChunks: Int32Array): TransferredChunks {
  const keys = Int32Array.from(dirtyChunks);
  const data = new Uint8Array(keys.length * CHUNK_AREA);
  const view = sim.view();
  for (let i = 0; i < keys.length; i++) {
    const key = keys[i]!;
    const chunk = view.getChunk(unpackChunkX(key), unpackChunkY(key));
    if (!chunk) continue;
    const offset = i * CHUNK_AREA;
    for (let j = 0; j < CHUNK_AREA; j++) data[offset + j] = chunk.at(j);
  }
  return { keys, data };
}

function buildDirtyRects(dirtyChunks: Int32Array): Rect[] {
  const rects: Rect[] = [];
  for (let i = 0; i < dirtyChunks.length; i++) {
    const key = dirtyChunks[i]!;
    const [x, y] = chunkToWorld(unpackChunkX(key), unpackChunkY(key));
    rects.push({ x, y, width: CHUNK_SIZE, height: CHUNK_SIZE });
  }
  return rects;
}

export function createHandler(opts: HandlerOptions): WorkerHandler {
  let sim: Simulation | null = null;
  let runHandle: number | null = null;
  let disposed = false;

  function requireSim(): Simulation {
    if (!sim) throw new Error('no simulation initialised; send "init" first');
    return sim;
  }

  function stopRun(): void {
    if (runHandle !== null) {
      opts.scheduler.clearInterval(runHandle);
      runHandle = null;
    }
  }

  /** Everything already known to have happened: post the resulting frame from a real `ChangeSet`. */
  function postFrame(active: Simulation, cs: ChangeSet): void {
    const chunks = buildTransferredChunks(active, cs.dirtyChunks);
    const dirty = buildDirtyRects(cs.dirtyChunks);
    opts.post(
      { type: 'frame', tick: active.tick, chunks, dirty, stats: copyStats(active.stats) },
      [chunks.data.buffer],
    );
  }

  /** For mutations with no incremental `ChangeSet` (`clear`, `seedRandom`, `seek`, …): a full-world frame via `snapshot()`, honestly labelled as "everything changed" rather than approximated as a dirty-rect list. */
  function postFullFrame(active: Simulation): void {
    const snap = active.snapshot();
    const chunks: TransferredChunks = { keys: snap.chunkKeys, data: snap.chunkData };
    const bounds = active.bounds();
    const dirty = bounds.width > 0 && bounds.height > 0 ? [bounds] : [];
    opts.post(
      { type: 'frame', tick: active.tick, chunks, dirty, stats: copyStats(active.stats) },
      [chunks.keys.buffer, chunks.data.buffer],
    );
  }

  function dispatch(cmd: Command): void {
    switch (cmd.cmd) {
      case 'init': {
        const ruleset = validateRuleSet(cmd.ruleset);
        sim = new Simulation({
          ruleset,
          width: cmd.width,
          height: cmd.height,
          seed: cmd.seed,
          ...(opts.clock ? { clock: opts.clock } : {}),
        });
        opts.post({ id: cmd.id, type: 'ready', capabilities: opts.capabilities });
        return;
      }
      case 'setRuleset': {
        const active = requireSim();
        active.setRuleset(validateRuleSet(cmd.ruleset));
        opts.post({ id: cmd.id, type: 'ok' });
        return;
      }
      case 'step': {
        const active = requireSim();
        const cs = active.stepMany(cmd.n);
        opts.post({ id: cmd.id, type: 'ok' });
        postFrame(active, cs);
        return;
      }
      case 'run': {
        requireSim();
        if (!(cmd.tps > 0)) throw new RangeError(`run.tps must be > 0, got ${cmd.tps}`);
        stopRun();
        runHandle = opts.scheduler.setInterval(() => {
          if (!sim || disposed) return;
          const cs = sim.step();
          postFrame(sim, cs);
        }, 1000 / cmd.tps);
        opts.post({ id: cmd.id, type: 'ok' });
        return;
      }
      case 'pause': {
        stopRun();
        opts.post({ id: cmd.id, type: 'ok' });
        return;
      }
      case 'paint': {
        const active = requireSim();
        const cs = active.paint(cmd.ops);
        opts.post({ id: cmd.id, type: 'ok' });
        postFrame(active, cs);
        return;
      }
      case 'clear': {
        const active = requireSim();
        active.clear();
        opts.post({ id: cmd.id, type: 'ok' });
        postFullFrame(active);
        return;
      }
      case 'seedRandom': {
        const active = requireSim();
        active.seedRandom(cmd.density, cmd.seed);
        opts.post({ id: cmd.id, type: 'ok' });
        postFullFrame(active);
        return;
      }
      case 'loadPattern': {
        requireSim();
        // Pattern I/O (RLE decoding) is Phase 2 (P2-A-1) — not a Phase 0 capability. Rejecting
        // clearly beats pretending to parse RLE with a codec that does not exist yet.
        throw new Error('loadPattern requires the RLE codec, which ships in Phase 2 (P2-A-1)');
      }
      case 'seek': {
        const active = requireSim();
        active.seek(cmd.tick);
        opts.post({ id: cmd.id, type: 'ok' });
        postFullFrame(active);
        return;
      }
      case 'snapshot': {
        const active = requireSim();
        const snap = active.snapshot();
        opts.post({ id: cmd.id, type: 'ok', result: snap }, [snap.chunkKeys.buffer, snap.chunkData.buffer]);
        return;
      }
      case 'setViewport': {
        // Nothing reads a viewport back yet — Phase 0 has no renderer (workstream H) and no
        // density LOD (Phase 5) to filter frames for. Accepted and acknowledged now so the
        // full command set round-trips; a future phase that needs it stores it here.
        requireSim();
        opts.post({ id: cmd.id, type: 'ok' });
        return;
      }
      case 'dispose': {
        stopRun();
        sim = null;
        disposed = true;
        opts.post({ id: cmd.id, type: 'ok' });
        return;
      }
      /* v8 ignore next 4 -- Command['cmd'] is a closed union; parseCommand already narrowed this file's only caller. */
      default: {
        const exhaustive: never = cmd;
        throw new Error(`unhandled command: ${JSON.stringify(exhaustive)}`);
      }
    }
  }

  function handle(raw: unknown): void {
    if (disposed) {
      opts.post({ id: extractId(raw), type: 'error', message: 'handler has been disposed', code: 'E_DISPOSED' });
      return;
    }
    const parsed = parseCommand(raw);
    if (!parsed.ok) {
      opts.post({ id: extractId(raw), type: 'error', message: parsed.issue.message, code: 'E_PROTOCOL' });
      return;
    }
    try {
      dispatch(parsed.value);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const code = err instanceof Error ? err.name : 'E_UNKNOWN';
      opts.post({ id: parsed.value.id, type: 'error', message, code });
    }
  }

  return { handle };
}
