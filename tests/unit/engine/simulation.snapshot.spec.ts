import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { Simulation } from '@engine/simulation';
import type { RuleSet, Snapshot } from '@engine/types';

const FIELD = { width: 64, height: 64 } as const;

function toroidal(rs: RuleSet): RuleSet {
  return { ...rs, boundary: 'toroidal' };
}

function identical(a: Snapshot, b: Snapshot): void {
  expect(a.tick).toBe(b.tick);
  expect(a.rngState).toBe(b.rngState);
  expect(a.chunkKeys).toEqual(b.chunkKeys);
  expect(a.chunkData).toEqual(b.chunkData);
}

function viaPostMessage(snap: Snapshot): Promise<Snapshot> {
  const { port1, port2 } = new MessageChannel();
  return new Promise((resolve) => {
    port2.once('message', (data: Snapshot) => {
      port1.close();
      port2.close();
      resolve(data);
    });
    port1.postMessage(snap, [
      snap.chunkKeys.buffer as ArrayBuffer,
      snap.chunkData.buffer as ArrayBuffer,
    ]);
  });
}

describe('P0-E-4 snapshot transport', () => {
  it('round-trips through structuredClone without sharing buffers', () => {
    const sim = new Simulation({ ruleset: toroidal(CONWAY), ...FIELD });
    sim.seedRandom(0.4, 7);
    sim.step();
    const snap = sim.snapshot();
    const clone = structuredClone(snap);
    expect(clone.chunkKeys).not.toBe(snap.chunkKeys);
    expect(clone.chunkData).not.toBe(snap.chunkData);
    identical(snap, clone);

    const other = new Simulation({ ruleset: toroidal(CONWAY), ...FIELD });
    other.restore(clone);
    identical(sim.snapshot(), other.snapshot());
  });

  it('round-trips through a real postMessage transfer (sender buffers detach)', async () => {
    const sim = new Simulation({ ruleset: toroidal(CONWAY), ...FIELD });
    sim.seedRandom(0.4, 11);
    for (let i = 0; i < 3; i++) sim.step();
    const snap = sim.snapshot();
    const keysBytes = snap.chunkKeys.byteLength;
    const dataBytes = snap.chunkData.byteLength;

    const received = await viaPostMessage(snap);
    expect(snap.chunkKeys.byteLength).toBe(0);
    expect(snap.chunkData.byteLength).toBe(0);
    expect(received.chunkKeys.byteLength).toBe(keysBytes);
    expect(received.chunkData.byteLength).toBe(dataBytes);

    const other = new Simulation({ ruleset: toroidal(CONWAY), ...FIELD });
    other.restore(received);
    expect(other.tick).toBe(sim.tick);
    expect(other.stats.population).toBe(sim.stats.population);

    const control = new Simulation({ ruleset: toroidal(CONWAY), ...FIELD, seed: 11 });
    control.seedRandom(0.4, 11);
    for (let i = 0; i < 3; i++) control.step();
    identical(control.snapshot(), other.snapshot());
  });

  it('rejects a snapshot whose chunkData length does not match its keys', () => {
    const sim = new Simulation({ ruleset: toroidal(CONWAY), width: 32, height: 32 });
    sim.set(0, 0, 1);
    const snap = sim.snapshot();
    expect(() => sim.restore({ ...snap, chunkData: snap.chunkData.subarray(0, 8) })).toThrow(
      /chunkData/,
    );
  });
});
