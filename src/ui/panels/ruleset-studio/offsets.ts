/**
 * Neighbourhood offset tables for the studio diagram (P2-E-2).
 *
 * Order is the engine's documented one (`src/engine/neighborhood/offsets.ts`):
 * row-major, `dy` outer, `dx` inner, `[0, 0]` skipped. The spec asserts this
 * module byte-matches `compileNeighborhood` — do not "improve" the order.
 */

export type Offset = readonly [dx: number, dy: number];

export function mooreOffsets(radius: number): Offset[] {
  const offsets: Offset[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      offsets.push([dx, dy]);
    }
  }
  return offsets;
}

export function vonNeumannOffsets(radius: number): Offset[] {
  const offsets: Offset[] = [];
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      if (Math.abs(dx) + Math.abs(dy) <= radius) offsets.push([dx, dy]);
    }
  }
  return offsets;
}

export function hexOffsets(rowParity: 0 | 1): Offset[] {
  return rowParity === 0
    ? [
        [1, 0],
        [0, -1],
        [-1, -1],
        [-1, 0],
        [-1, 1],
        [0, 1],
      ]
    : [
        [1, 0],
        [1, -1],
        [0, -1],
        [-1, 0],
        [0, 1],
        [1, 1],
      ];
}

export interface StudioNeighborhood {
  readonly kind: 'moore' | 'vonNeumann' | 'hex' | 'custom';
  readonly radius?: number;
  readonly offsets?: readonly Offset[];
}

export function neighborCount(neighborhood: StudioNeighborhood): number {
  switch (neighborhood.kind) {
    case 'moore':
      return mooreOffsets(neighborhood.radius ?? 1).length;
    case 'vonNeumann':
      return vonNeumannOffsets(neighborhood.radius ?? 1).length;
    case 'hex':
      return 6;
    case 'custom':
      return neighborhood.offsets?.length ?? 0;
    default:
      return 0;
  }
}

/** Even-row offsets; hex odd-row is {@link hexOffsets}(1). */
export function offsetsFor(neighborhood: StudioNeighborhood, rowParity: 0 | 1 = 0): Offset[] {
  switch (neighborhood.kind) {
    case 'moore':
      return mooreOffsets(neighborhood.radius ?? 1);
    case 'vonNeumann':
      return vonNeumannOffsets(neighborhood.radius ?? 1);
    case 'hex':
      return hexOffsets(rowParity);
    case 'custom':
      return [...(neighborhood.offsets ?? [])];
    default:
      return [];
  }
}

export function unpackCompiled(packed: ArrayLike<number>): Offset[] {
  const out: Offset[] = [];
  for (let i = 0; i + 1 < packed.length; i += 2) {
    out.push([packed[i]!, packed[i + 1]!]);
  }
  return out;
}
