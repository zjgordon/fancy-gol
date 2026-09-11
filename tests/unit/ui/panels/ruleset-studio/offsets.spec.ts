import { describe, expect, it } from 'vitest';
import { compileNeighborhood } from '@engine/neighborhood';
import { hexOffsets, offsetsFor, unpackCompiled } from '@ui/panels/ruleset-studio/offsets';

describe('studio offsets match compileNeighborhood', () => {
  it('Moore r=1 and r=2', () => {
    for (const radius of [1, 2] as const) {
      const compiled = compileNeighborhood({ kind: 'moore', radius });
      expect(offsetsFor({ kind: 'moore', radius })).toEqual(unpackCompiled(compiled.offsetsByParity[0]));
      expect(offsetsFor({ kind: 'moore', radius })).toEqual(unpackCompiled(compiled.offsetsByParity[1]));
    }
  });

  it('von Neumann r=1', () => {
    const compiled = compileNeighborhood({ kind: 'vonNeumann', radius: 1 });
    expect(offsetsFor({ kind: 'vonNeumann', radius: 1 })).toEqual(unpackCompiled(compiled.offsetsByParity[0]));
  });

  it('hex even and odd rows', () => {
    const compiled = compileNeighborhood({ kind: 'hex' });
    expect(offsetsFor({ kind: 'hex' }, 0)).toEqual(unpackCompiled(compiled.offsetsByParity[0]));
    expect(offsetsFor({ kind: 'hex' }, 1)).toEqual(unpackCompiled(compiled.offsetsByParity[1]));
    expect(hexOffsets(0)).not.toEqual(hexOffsets(1));
  });

  it('custom offsets keep the declared pairs', () => {
    const offsets = [
      [1, 0],
      [0, 1],
      [-1, 0],
    ] as const;
    const compiled = compileNeighborhood({ kind: 'custom', offsets });
    expect(offsetsFor({ kind: 'custom', offsets })).toEqual(unpackCompiled(compiled.offsetsByParity[0]));
  });
});
