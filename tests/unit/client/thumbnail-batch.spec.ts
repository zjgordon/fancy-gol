import { describe, expect, it } from 'vitest';
import { shouldStepThumbnails, thumbnailBatch } from '@client/thumbnail-batch';

describe('thumbnailBatch', () => {
  it('rotates a fixed-size window around the catalogue', () => {
    const a = thumbnailBatch(14, 0, 4);
    expect(a.indices).toEqual([0, 1, 2, 3]);
    const b = thumbnailBatch(14, a.nextOffset, 4);
    expect(b.indices).toEqual([4, 5, 6, 7]);
    expect(thumbnailBatch(3, 0, 4).indices).toEqual([0, 1, 2]);
    expect(thumbnailBatch(0, 0, 4).indices).toEqual([]);
  });
});

describe('shouldStepThumbnails', () => {
  it('fires every N frames and never on a zero period', () => {
    expect(shouldStepThumbnails(30, 30)).toBe(true);
    expect(shouldStepThumbnails(29, 30)).toBe(false);
    expect(shouldStepThumbnails(1, 0)).toBe(false);
  });
});
