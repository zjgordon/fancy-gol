import { describe, expect, it } from 'vitest';
import { CONWAY } from '@engine/rules/builtin';
import {
  PROTOCOL_VERSION,
  parseCommand,
  parseEvent,
  type Command,
  type Event,
} from '@shared/protocol';

/**
 * A switch over every `Command['cmd']` kind, mirroring `parseCommand`'s own. If a `Command`
 * variant is ever added without a case here, `cmd` in `default` no longer narrows to `never`
 * and `assertExhaustive` fails to compile — this is P0-G-1's exhaustiveness acceptance
 * criterion made concrete and test-visible, not just inline in the implementation.
 */
function assertExhaustive(x: never): never {
  throw new Error(`unreachable command kind: ${JSON.stringify(x)}`);
}

function kindOf(cmd: Command['cmd']): Command['cmd'] {
  switch (cmd) {
    case 'init':
    case 'setRuleset':
    case 'step':
    case 'run':
    case 'pause':
    case 'paint':
    case 'clear':
    case 'seedRandom':
    case 'loadPattern':
    case 'seek':
    case 'snapshot':
    case 'setViewport':
    case 'dispose':
      return cmd;
    default:
      return assertExhaustive(cmd);
  }
}

const ALL_KINDS: readonly Command['cmd'][] = [
  'init',
  'setRuleset',
  'step',
  'run',
  'pause',
  'paint',
  'clear',
  'seedRandom',
  'loadPattern',
  'seek',
  'snapshot',
  'setViewport',
  'dispose',
];

describe('Command exhaustiveness', () => {
  it('every known kind round-trips through the exhaustive switch unchanged', () => {
    for (const kind of ALL_KINDS) expect(kindOf(kind)).toBe(kind);
  });
});

describe('PROTOCOL_VERSION', () => {
  it('is a stable, positive integer', () => {
    expect(Number.isInteger(PROTOCOL_VERSION)).toBe(true);
    expect(PROTOCOL_VERSION).toBeGreaterThan(0);
  });
});

const VALID_COMMANDS: Record<Command['cmd'], Record<string, unknown>> = {
  init: { id: 1, cmd: 'init', ruleset: CONWAY, width: 64, height: 64, seed: 7 },
  setRuleset: { id: 2, cmd: 'setRuleset', ruleset: CONWAY },
  step: { id: 3, cmd: 'step', n: 5 },
  run: { id: 4, cmd: 'run', tps: 60 },
  pause: { id: 5, cmd: 'pause' },
  paint: { id: 6, cmd: 'paint', ops: [{ x: 0, y: 0, state: 1 }] },
  clear: { id: 7, cmd: 'clear' },
  seedRandom: { id: 8, cmd: 'seedRandom', density: 0.5, seed: 1 },
  loadPattern: { id: 9, cmd: 'loadPattern', rle: 'bo$2bo$3o!', x: 0, y: 0 },
  seek: { id: 10, cmd: 'seek', tick: 42 },
  snapshot: { id: 11, cmd: 'snapshot' },
  setViewport: {
    id: 12,
    cmd: 'setViewport',
    viewport: { rect: { x: 0, y: 0, width: 10, height: 10 }, scale: 1 },
  },
  dispose: { id: 13, cmd: 'dispose' },
};

describe('parseCommand: valid messages', () => {
  for (const kind of ALL_KINDS) {
    it(`accepts a well-formed "${kind}" command`, () => {
      const result = parseCommand(VALID_COMMANDS[kind]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.cmd).toBe(kind);
    });
  }
});

describe('parseCommand: every required field rejects when missing or wrongly typed', () => {
  for (const kind of ALL_KINDS) {
    const valid = VALID_COMMANDS[kind];
    for (const key of Object.keys(valid)) {
      if (key === 'cmd') continue; // covered by the "unknown cmd" case elsewhere

      it(`rejects "${kind}" with "${key}" missing`, () => {
        const rest = Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
        const result = parseCommand(rest);
        expect(result.ok).toBe(false);
      });

      if (key !== 'id') {
        it(`rejects "${kind}" with "${key}" set to the wrong type`, () => {
          const result = parseCommand({ ...valid, [key]: Symbol('wrong-type') });
          expect(result.ok).toBe(false);
        });
      }
    }
  }
});

describe('parseCommand: malformed messages reject with a structured issue, never throw', () => {
  it('rejects non-object input', () => {
    for (const raw of [undefined, null, 42, 'nope', [], true]) {
      expect(() => parseCommand(raw)).not.toThrow();
      const result = parseCommand(raw);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a missing id', () => {
    const result = parseCommand({ cmd: 'pause' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('id');
  });

  it('rejects an unknown cmd', () => {
    const result = parseCommand({ id: 1, cmd: 'flarp' });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.issue.path).toBe('cmd');
      expect(result.issue.message).toContain('flarp');
    }
  });

  it('rejects init with a non-RuleSet-shaped ruleset', () => {
    const result = parseCommand({ id: 1, cmd: 'init', ruleset: {}, width: 1, height: 1, seed: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('ruleset');
  });

  it('rejects init with a missing width', () => {
    const result = parseCommand({ id: 1, cmd: 'init', ruleset: CONWAY, height: 1, seed: 1 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('width');
  });

  it('rejects paint with a non-array ops', () => {
    const result = parseCommand({ id: 1, cmd: 'paint', ops: 'nope' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('ops');
  });

  it('rejects paint with a malformed op', () => {
    const result = parseCommand({ id: 1, cmd: 'paint', ops: [{ x: 0, y: 0 }] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('ops');
  });

  it('rejects setViewport with a malformed viewport', () => {
    const result = parseCommand({ id: 1, cmd: 'setViewport', viewport: { scale: 1 } });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('viewport');
  });

  it('rejects loadPattern with an empty rle', () => {
    const result = parseCommand({ id: 1, cmd: 'loadPattern', rle: '', x: 0, y: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('rle');
  });
});

const VALID_EVENTS: Record<Event['type'], Record<string, unknown>> = {
  ready: {
    id: 1,
    type: 'ready',
    capabilities: { sharedArrayBuffer: false, offscreenCanvas: true },
  },
  frame: {
    type: 'frame',
    tick: 5,
    chunks: { keys: new Int32Array([0]), data: new Uint8Array(1024) },
    dirty: [{ x: 0, y: 0, width: 32, height: 32 }],
    stats: {
      tick: 5,
      population: 4,
      perState: new Uint32Array(2),
      births: 0,
      deaths: 0,
      transitions: 0,
      activeChunks: 1,
      stepMicros: 12,
    },
  },
  stats: {
    type: 'stats',
    series: {
      tick: 5,
      population: 4,
      perState: new Uint32Array(2),
      births: 0,
      deaths: 0,
      transitions: 0,
      activity: 0,
      density: 0.1,
      bbox: { x: 0, y: 0, width: 4, height: 4 },
      centroid: { x: 2, y: 2 },
      entropy: 0,
      hash: 0,
    },
  },
  ok: { id: 1, type: 'ok', result: { snapshot: true } },
  error: { id: 1, type: 'error', message: 'boom', code: 'E_BOOM' },
};

describe('parseEvent: valid messages', () => {
  for (const type of Object.keys(VALID_EVENTS) as Event['type'][]) {
    it(`accepts a well-formed "${type}" event`, () => {
      const result = parseEvent(VALID_EVENTS[type]);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.value.type).toBe(type);
    });
  }

  it('accepts an "ok" event with no result at all', () => {
    const result = parseEvent({ id: 1, type: 'ok' });
    expect(result.ok).toBe(true);
    if (result.ok && result.value.type === 'ok') expect('result' in result.value).toBe(false);
  });
});

describe('parseEvent: every required field rejects when missing or wrongly typed', () => {
  for (const type of Object.keys(VALID_EVENTS) as Event['type'][]) {
    const valid = VALID_EVENTS[type];
    for (const key of Object.keys(valid)) {
      if (key === 'type') continue; // covered by the "unknown type" case elsewhere

      if (key !== 'result') {
        // `ok.result` is genuinely optional — omitting it is valid (see above),
        // so it's excluded from the "missing" half of this loop.
        it(`rejects "${type}" with "${key}" missing`, () => {
          const rest = Object.fromEntries(Object.entries(valid).filter(([k]) => k !== key));
          const result = parseEvent(rest);
          expect(result.ok).toBe(false);
        });
      }

      if (key !== 'id' && key !== 'result') {
        it(`rejects "${type}" with "${key}" set to the wrong type`, () => {
          const result = parseEvent({ ...valid, [key]: Symbol('wrong-type') });
          expect(result.ok).toBe(false);
        });
      }
    }
  }
});

describe('parseEvent: malformed messages reject with a structured issue, never throw', () => {
  it('rejects non-object input', () => {
    for (const raw of [undefined, null, 7, 'nope', []]) {
      expect(() => parseEvent(raw)).not.toThrow();
      expect(parseEvent(raw).ok).toBe(false);
    }
  });

  it('rejects an unknown type', () => {
    const result = parseEvent({ type: 'wat' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('type');
  });

  it('rejects error missing message/code', () => {
    const result = parseEvent({ id: 1, type: 'error', code: 'E_X' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('message');
  });

  it('rejects frame with non-transferable chunks', () => {
    const result = parseEvent({
      type: 'frame',
      tick: 1,
      chunks: { keys: [], data: [] },
      dirty: [],
      stats: {},
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issue.path).toBe('chunks');
  });
});
