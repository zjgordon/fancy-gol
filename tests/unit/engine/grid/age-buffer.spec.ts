import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { AGE_SATURATION, Chunk } from '@engine/grid/chunk';
import { Simulation } from '@engine/simulation';

/**
 * Reference ages: last-change tick per packed cell, age = min(sim.tick - last, 65535).
 * Independent of the chunk buffers — the property oracle for P3-A-2.
 */
class ReferenceAges {
  private readonly lastChange = new Map<number, number>();

  note(x: number, y: number, tick: number): void {
    this.lastChange.set(((x & 0xffff) << 16) | (y & 0xffff), tick);
  }

  ageAt(x: number, y: number, tick: number): number {
    const last = this.lastChange.get(((x & 0xffff) << 16) | (y & 0xffff)) ?? 0;
    const raw = tick - last;
    return raw < 0 ? 0 : raw > AGE_SATURATION ? AGE_SATURATION : raw;
  }

  /** After a step ChangeSet, mark every changed cell as changed at `tickAfter`. */
  applyChangeSet(coords: Int32Array, count: number, tickAfter: number): void {
    for (let i = 0; i < count; i++) {
      const packed = coords[i]!;
      this.lastChange.set(packed, tickAfter);
    }
  }
}

describe('Chunk age buffer', () => {
  it('allocates lazily via ensureAge and resets on write', () => {
    const chunk = Chunk.acquire();
    expect(chunk.age).toBeNull();
    const ages = chunk.ensureAge();
    expect(ages).toBeInstanceOf(Uint16Array);
    expect(ages.length).toBe(1024);
    ages[0] = 42;
    chunk.write(0, 1);
    expect(ages[0]).toBe(0);
    chunk.bumpAllAges();
    expect(ages[0]).toBe(1);
    for (let i = 0; i < 10; i++) ages[1] = AGE_SATURATION;
    chunk.bumpAllAges();
    expect(ages[1]).toBe(AGE_SATURATION);
    Chunk.release(chunk);
    expect(chunk.age).toBeNull();
  });
});

describe('Simulation age buffer', () => {
  it('is off by default and allocates no age pages', () => {
    const sim = new Simulation({ ruleset: CONWAY, width: 64, height: 64, seed: 1 });
    expect(sim.ageBuffer).toBe(false);
    sim.paint([{ x: 10, y: 10, state: 1 }]);
    for (let i = 0; i < 8; i++) sim.step();
    expect(sim.collectAges(new Int32Array([0]))).toBeUndefined();
  });

  it('disabling drops every age buffer so the Phase 2 path is restored', () => {
    const sim = new Simulation({
      ruleset: CONWAY,
      width: 64,
      height: 64,
      seed: 2,
      ageBuffer: true,
    });
    sim.seedRandom(0.3, 2);
    for (let i = 0; i < 4; i++) sim.step();
    expect(sim.collectAges(sim.snapshot().chunkKeys)).toBeInstanceOf(Uint16Array);
    sim.setAgeBuffer(false);
    expect(sim.ageBuffer).toBe(false);
    expect(sim.collectAges(sim.snapshot().chunkKeys)).toBeUndefined();
    expect(sim.ageAt(0, 0)).toBe(0);
  });

  it('ages are exact after 10,000 generations against a reference computation', () => {
    const WIDTH = 32;
    const HEIGHT = 32;
    const GENERATIONS = 10_000;
    const sim = new Simulation({
      ruleset: CONWAY,
      width: WIDTH,
      height: HEIGHT,
      seed: 9,
      ageBuffer: true,
    });
    const ref = new ReferenceAges();
    const everTouched = new Set<number>();

    // Blinker + a still life so some cells stay forever and some oscillate.
    const seed: Array<readonly [number, number]> = [
      [8, 8],
      [9, 8],
      [10, 8], // blinker
      [20, 20],
      [21, 20],
      [20, 21],
      [21, 21], // block
    ];
    sim.paint(seed.map(([x, y]) => ({ x, y, state: 1 })));
    for (const [x, y] of seed) {
      ref.note(x, y, 0);
      everTouched.add(((x & 0xffff) << 16) | (y & 0xffff));
    }

    for (let g = 0; g < GENERATIONS; g++) {
      const cs = sim.step();
      ref.applyChangeSet(cs.coords, cs.count, sim.tick);
      for (let i = 0; i < cs.count; i++) everTouched.add(cs.coords[i]!);
    }

    expect(sim.tick).toBe(GENERATIONS);
    for (const packed of everTouched) {
      const x = (packed >>> 16) & 0xffff;
      const y = packed & 0xffff;
      expect(sim.ageAt(x, y)).toBe(ref.ageAt(x, y, sim.tick));
    }
  }, 60_000);

  it('with age off, step ChangeSets match an age-on twin for the same seed (behaviour unchanged)', () => {
    const mk = (age: boolean) =>
      new Simulation({ ruleset: CONWAY, width: 64, height: 64, seed: 11, ageBuffer: age });
    const a = mk(false);
    const b = mk(true);
    a.seedRandom(0.4, 11);
    b.seedRandom(0.4, 11);
    for (let i = 0; i < 40; i++) {
      const ca = a.step();
      const cb = b.step();
      expect(ca.count).toBe(cb.count);
      for (let k = 0; k < ca.count; k++) {
        expect(ca.coords[k]).toBe(cb.coords[k]);
        expect(ca.from[k]).toBe(cb.from[k]);
        expect(ca.to[k]).toBe(cb.to[k]);
      }
    }
    expect(a.snapshot().chunkData).toEqual(b.snapshot().chunkData);
  });
});
