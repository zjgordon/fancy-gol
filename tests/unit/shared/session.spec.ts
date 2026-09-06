import { describe, expect, it } from 'vitest';
import { CURRENT_SESSION_VERSION, migrateSessionDoc, upgradeToVersion, type SessionDoc } from '@shared/session';

function validDoc(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 3, y = 3\nbob$3o$bob!',
    gridOrigin: { x: -2, y: 5 },
    tick: 42,
    seed: 7,
    camera: { originX: 1.5, originY: -2.25, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
    ...overrides,
  };
}

describe('migrateSessionDoc — validation', () => {
  it('accepts a well-formed v1 document unchanged', () => {
    const doc = validDoc();
    expect(migrateSessionDoc(doc)).toEqual(doc);
  });

  it('accepts an inline ruleset reference', () => {
    const doc = validDoc({
      ruleset: {
        kind: 'inline',
        ruleset: {
          id: 'user:custom',
          name: 'Custom',
          states: [],
          neighborhood: { kind: 'moore', radius: 1 },
          transition: { kind: 'totalistic', born: [3], survive: [2, 3] },
          boundary: 'toroidal',
        },
      },
    });
    expect(migrateSessionDoc(doc)).toEqual(doc);
  });

  it.each([null, undefined, 'a string', 42, [1, 2, 3]])('rejects a non-object top level (%p)', (raw) => {
    expect(migrateSessionDoc(raw)).toBeNull();
  });

  it('rejects a missing or non-numeric version', () => {
    const withoutVersion: Record<string, unknown> = { ...validDoc() };
    delete withoutVersion['version'];
    expect(migrateSessionDoc(withoutVersion)).toBeNull();
    expect(migrateSessionDoc({ ...validDoc(), version: 'one' })).toBeNull();
  });

  it('rejects version 0 or negative', () => {
    expect(migrateSessionDoc({ ...validDoc(), version: 0 })).toBeNull();
    expect(migrateSessionDoc({ ...validDoc(), version: -1 })).toBeNull();
  });

  it('rejects a version newer than this build understands (no migration path forward)', () => {
    expect(migrateSessionDoc({ ...validDoc(), version: CURRENT_SESSION_VERSION + 1 })).toBeNull();
  });

  it.each([
    ['ruleset', { kind: 'nonsense' }],
    ['grid', 42],
    ['gridOrigin', { x: 1 }],
    ['tick', 'soon'],
    ['seed', null],
    ['camera', { originX: 1, originY: 2 }],
    ['theme', 7],
    ['toolState', { activeToolId: 7 }],
  ])('rejects an invalid %s field', (field, badValue) => {
    expect(migrateSessionDoc({ ...validDoc(), [field]: badValue })).toBeNull();
  });

  it('rejects a builtin ruleset reference missing its id', () => {
    expect(migrateSessionDoc({ ...validDoc(), ruleset: { kind: 'builtin' } })).toBeNull();
  });

  it('rejects an inline ruleset reference whose ruleset is not an object', () => {
    expect(migrateSessionDoc({ ...validDoc(), ruleset: { kind: 'inline', ruleset: 'nope' } })).toBeNull();
  });
});

describe('migrateSessionDoc — forward compatibility (this task’s own acceptance criterion)', () => {
  /**
   * A literal v1 document, frozen exactly as a real v1 build would have written it — not
   * constructed from today's `validDoc()` helper, so a future change to that helper can't
   * accidentally keep this passing for the wrong reason. When Phase 2 or 4 changes the format,
   * whoever does it adds a `MIGRATIONS[1]` step (see `shared/session.ts`'s own doc comment) and
   * this exact fixture — unmodified — must still resolve to a valid current `SessionDoc`. That
   * is the whole point of committing it now.
   */
  const FROZEN_V1_DOCUMENT = {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 2, y = 1\n2o!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 12345,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
  };

  it('still loads today', () => {
    const migrated = migrateSessionDoc(FROZEN_V1_DOCUMENT);
    expect(migrated).not.toBeNull();
    expect(migrated?.version).toBe(CURRENT_SESSION_VERSION);
    expect(migrated?.grid).toBe('x = 2, y = 1\n2o!');
  });
});

describe('upgradeToVersion — the chaining mechanism itself (synthetic, since real MIGRATIONS is still empty)', () => {
  it('returns the document unchanged when already at the target version', () => {
    const doc = { hello: 'world' };
    expect(upgradeToVersion(doc, 1, 1, {})).toBe(doc);
  });

  it('applies a single migration step', () => {
    const doc = { value: 1 };
    const migrations = { 1: (d: Record<string, unknown>) => ({ ...d, value: (d['value'] as number) + 1 }) };
    expect(upgradeToVersion(doc, 1, 2, migrations)).toEqual({ value: 2 });
  });

  it('chains multiple hops in order', () => {
    const doc = { path: [] as string[] };
    const migrations = {
      1: (d: Record<string, unknown>) => ({ path: [...(d['path'] as string[]), 'v1->v2'] }),
      2: (d: Record<string, unknown>) => ({ path: [...(d['path'] as string[]), 'v2->v3'] }),
    };
    expect(upgradeToVersion(doc, 1, 3, migrations)).toEqual({ path: ['v1->v2', 'v2->v3'] });
  });

  it('returns null, not a half-upgraded document, when a hop is missing a migration', () => {
    const doc = { value: 1 };
    const migrations = { 1: (d: Record<string, unknown>) => ({ ...d, value: 2 }) };
    // No entry for version 2 -- can't reach target version 3.
    expect(upgradeToVersion(doc, 1, 3, migrations)).toBeNull();
  });
});
