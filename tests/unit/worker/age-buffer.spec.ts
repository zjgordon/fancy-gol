import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import { CHUNK_AREA } from '@engine/grid/coords';
import { createHandler, type Scheduler } from '@worker/handler';
import type { Event, TransferredChunks } from '@shared/protocol';

class NoopScheduler implements Scheduler {
  setInterval(): number {
    throw new Error('not used');
  }
  clearInterval(): void {}
}

describe('handler age buffer transfer', () => {
  it('omits ages by default and includes them after setAgeBuffer', () => {
    const frames: TransferredChunks[] = [];
    const handler = createHandler({
      post: (event: Event) => {
        if (event.type === 'frame') frames.push(event.chunks);
      },
      scheduler: new NoopScheduler(),
      capabilities: { sharedArrayBuffer: false, offscreenCanvas: false },
      recordStats: false,
    });

    handler.handle({
      id: 1,
      cmd: 'init',
      ruleset: CONWAY,
      width: 64,
      height: 64,
      seed: 1,
    });
    handler.handle({
      id: 2,
      cmd: 'paint',
      ops: [
        { x: 8, y: 8, state: 1 },
        { x: 9, y: 8, state: 1 },
        { x: 10, y: 8, state: 1 },
      ],
    });
    handler.handle({ id: 3, cmd: 'step', n: 1 });
    expect(frames.at(-1)?.ages).toBeUndefined();

    handler.handle({ id: 4, cmd: 'setAgeBuffer', enabled: true });
    handler.handle({ id: 5, cmd: 'step', n: 1 });
    const withAges = frames.at(-1)!;
    expect(withAges.ages).toBeInstanceOf(Uint16Array);
    expect(withAges.ages!.length).toBe(withAges.keys.length * CHUNK_AREA);

    handler.handle({ id: 6, cmd: 'setAgeBuffer', enabled: false });
    handler.handle({ id: 7, cmd: 'step', n: 1 });
    expect(frames.at(-1)?.ages).toBeUndefined();
  });
});
