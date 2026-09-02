/**
 * Compiles a declarative {@link Neighborhood} into flat `Int8Array` offset tables, computed
 * once at rule-compile time and never touched per-cell.
 */
import type { Neighborhood } from '../types';
import { RuleValidationError } from '../rules/errors';
import { type Offset, hexOffsets, mooreOffsets, vonNeumannOffsets } from './offsets';

export const MAX_CUSTOM_OFFSETS = 48;

export interface CompiledNeighborhood {
  /** How wide a halo the grid must read around a chunk's interior for this neighbourhood. */
  readonly maxRadius: number;
  /** Number of offsets (same for both row parities). */
  readonly count: number;
  /**
   * Flattened `[dx0, dy0, dx1, dy1, ...]` pairs, indexed by the *center* cell's row parity
   * (`y & 1`). Identical for both parities except `hex`, where the neighbour set genuinely
   * differs by row.
   */
  readonly offsetsByParity: readonly [Int8Array, Int8Array];
}

function toInt8Array(offsets: readonly Offset[]): Int8Array {
  const packed = new Int8Array(offsets.length * 2);
  offsets.forEach(([dx, dy], i) => {
    packed[i * 2] = dx;
    packed[i * 2 + 1] = dy;
  });
  return packed;
}

function maxRadiusOf(offsets: readonly Offset[]): number {
  let max = 0;
  for (const [dx, dy] of offsets) {
    max = Math.max(max, Math.abs(dx), Math.abs(dy));
  }
  return max;
}

function uniform(offsets: Offset[], maxRadius: number): CompiledNeighborhood {
  const packed = toInt8Array(offsets);
  return { maxRadius, count: offsets.length, offsetsByParity: [packed, packed] };
}

function compileCustom(offsets: readonly Offset[]): CompiledNeighborhood {
  const seen = new Set<string>();
  const deduped: Offset[] = [];

  for (const offset of offsets) {
    const [dx, dy] = offset;
    if (dx === 0 && dy === 0) {
      throw new RuleValidationError([
        {
          path: '/neighborhood/offsets',
          message: 'custom neighbourhood offsets must not include [0, 0]',
          hint: 'a cell is never its own neighbour',
        },
      ]);
    }
    const key = `${dx},${dy}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(offset);
  }

  if (deduped.length > MAX_CUSTOM_OFFSETS) {
    throw new RuleValidationError([
      {
        path: '/neighborhood/offsets',
        message: `custom neighbourhood declares ${deduped.length} distinct offsets, exceeding the cap of ${MAX_CUSTOM_OFFSETS}`,
        hint: `keep it to ${MAX_CUSTOM_OFFSETS} or fewer offsets`,
      },
    ]);
  }

  return uniform(deduped, maxRadiusOf(deduped));
}

export function compileNeighborhood(neighborhood: Neighborhood): CompiledNeighborhood {
  switch (neighborhood.kind) {
    case 'moore':
      return uniform(mooreOffsets(neighborhood.radius), neighborhood.radius);
    case 'vonNeumann':
      return uniform(vonNeumannOffsets(neighborhood.radius), neighborhood.radius);
    case 'hex':
      return {
        maxRadius: 1,
        count: 6,
        offsetsByParity: [toInt8Array(hexOffsets(0)), toInt8Array(hexOffsets(1))],
      };
    case 'custom':
      return compileCustom(neighborhood.offsets);
    default: {
      const exhaustive: never = neighborhood;
      throw new Error(`unknown neighbourhood kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}

export { hexOffsets, mooreOffsets, vonNeumannOffsets };
export type { Offset };
