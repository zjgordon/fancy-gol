import { describe, expect, it } from 'vitest';
import { Mulberry32 } from '@engine/rng';
import { RuleValidationError } from '@engine/rules/errors';
import { compileNeighborhood, hexOffsets, MAX_CUSTOM_OFFSETS, mooreOffsets } from '@engine/neighborhood';

function unpack(arr: Int8Array): Array<[number, number]> {
  const out: Array<[number, number]> = [];
  for (let i = 0; i < arr.length; i += 2) {
    out.push([arr[i] as number, arr[i + 1] as number]);
  }
  return out;
}

describe('moore', () => {
  it('r=1 yields exactly the 8 classic offsets in the documented row-major order', () => {
    expect(mooreOffsets(1)).toEqual([
      [-1, -1],
      [0, -1],
      [1, -1],
      [-1, 0],
      [1, 0],
      [-1, 1],
      [0, 1],
      [1, 1],
    ]);
  });

  it('r=2 yields (2r+1)^2 - 1 offsets', () => {
    expect(mooreOffsets(2)).toHaveLength(24);
  });

  it('compileNeighborhood reports maxRadius and packs the same offsets for both parities', () => {
    const compiled = compileNeighborhood({ kind: 'moore', radius: 1 });
    expect(compiled.maxRadius).toBe(1);
    expect(compiled.count).toBe(8);
    expect(unpack(compiled.offsetsByParity[0])).toEqual(unpack(compiled.offsetsByParity[1]));
  });
});

describe('vonNeumann', () => {
  it('r=1 yields the 4 classic offsets', () => {
    const compiled = compileNeighborhood({ kind: 'vonNeumann', radius: 1 });
    expect(compiled.count).toBe(4);
    expect(unpack(compiled.offsetsByParity[0])).toEqual(
      expect.arrayContaining([
        [0, -1],
        [-1, 0],
        [1, 0],
        [0, 1],
      ]),
    );
  });
});

describe('hex', () => {
  it('yields exactly 6 offsets per row parity', () => {
    expect(hexOffsets(0)).toHaveLength(6);
    expect(hexOffsets(1)).toHaveLength(6);
  });

  it('is symmetric: if B is a neighbour of A, A is a neighbour of B (10k cells, both parities)', () => {
    const rng = new Mulberry32(0x5ec7);
    for (let i = 0; i < 10_000; i++) {
      const ax = rng.nextInt(2001) - 1000;
      const ay = rng.nextInt(2001) - 1000;
      const aParity = ((ay % 2) + 2) % 2 === 0 ? 0 : 1;
      const [dx, dy] = hexOffsets(aParity)[rng.nextInt(6)] as [number, number];
      const bx = ax + dx;
      const by = ay + dy;
      const bParity = ((by % 2) + 2) % 2 === 0 ? 0 : 1;

      const bNeighboursOfB = hexOffsets(bParity).map(
        ([ox, oy]) => [bx + ox, by + oy] as const,
      );
      expect(bNeighboursOfB).toContainEqual([ax, ay]);
    }
  });
});

describe('custom', () => {
  it('dedups offsets', () => {
    const compiled = compileNeighborhood({
      kind: 'custom',
      offsets: [
        [1, 0],
        [1, 0],
        [0, 1],
      ],
    });
    expect(compiled.count).toBe(2);
  });

  it('rejects [0, 0]', () => {
    expect(() =>
      compileNeighborhood({ kind: 'custom', offsets: [[0, 0]] }),
    ).toThrow(RuleValidationError);
  });

  it('throws, naming the cap, once distinct offsets exceed MAX_CUSTOM_OFFSETS', () => {
    const offsets: Array<readonly [number, number]> = [];
    for (let i = 1; i <= MAX_CUSTOM_OFFSETS + 1; i++) offsets.push([i, 0]);

    let error: unknown;
    try {
      compileNeighborhood({ kind: 'custom', offsets });
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(RuleValidationError);
    expect((error as RuleValidationError).issues[0]?.message).toContain(String(MAX_CUSTOM_OFFSETS));
  });

  it('accepts exactly the cap', () => {
    const offsets: Array<readonly [number, number]> = [];
    for (let i = 1; i <= MAX_CUSTOM_OFFSETS; i++) offsets.push([i, 0]);
    const compiled = compileNeighborhood({ kind: 'custom', offsets });
    expect(compiled.count).toBe(MAX_CUSTOM_OFFSETS);
  });
});
