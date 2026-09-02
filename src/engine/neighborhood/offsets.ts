/**
 * Raw `[dx, dy]` offset generators, one per neighbourhood shape. Row-major order
 * (`dy` outer, `dx` inner), skipping `[0, 0]` — this is the "documented, stable order"
 * the rest of the engine relies on.
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

/**
 * Pointy-top hex neighbours, "odd-r" horizontal offset layout: which 6 cells count as
 * neighbours depends on whether the row is even or odd. Symmetric by construction — B is a
 * neighbour of A in this layout iff A is a neighbour of B, for every row-parity pairing.
 */
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
