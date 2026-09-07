import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@server/app';
import { deriveUserRulesetId } from '@server/routes/rulesets';

const FIXTURE_DIST = fileURLToPath(new URL('../../fixtures/server/dist-client', import.meta.url));

const VALID_RULE = {
  version: 1,
  id: 'My Cool Rule',
  name: 'My Cool Rule',
  description: 'A test rule',
  states: [
    { id: 0, name: 'dead', kind: 'dead', countsAsAlive: false },
    { id: 1, name: 'alive', kind: 'live', countsAsAlive: true },
  ],
  neighborhood: { kind: 'moore', radius: 1 },
  transition: { kind: 'totalistic', born: [3], survive: [2, 3] },
  boundary: 'toroidal',
};

describe('deriveUserRulesetId (pure)', () => {
  it('slugifies a friendly name into a namespaced id', () => {
    expect(deriveUserRulesetId('My Cool Rule')).toBe('user:my-cool-rule');
  });

  it('strips a redundant user: prefix before re-deriving it', () => {
    expect(deriveUserRulesetId('user:My Cool Rule')).toBe('user:my-cool-rule');
  });

  it('collapses runs of punctuation-turned-hyphens and trims the edges', () => {
    expect(deriveUserRulesetId("Rule -- Two's  Cousin")).toBe('user:rule-two-s-cousin');
  });

  it('rejects a path-traversal attempt outright, never sanitising it into something safe', () => {
    expect(deriveUserRulesetId('../../etc/passwd')).toBeNull();
  });

  it('rejects anything containing a slash, backslash, or dot', () => {
    expect(deriveUserRulesetId('a/b')).toBeNull();
    expect(deriveUserRulesetId('a\\b')).toBeNull();
    expect(deriveUserRulesetId('a.b')).toBeNull();
  });

  it('rejects an id that slugifies to nothing', () => {
    expect(deriveUserRulesetId('---')).toBeNull();
  });

  it('rejects an empty string', () => {
    expect(deriveUserRulesetId('')).toBeNull();
  });
});

let server: Server;
let baseUrl: string;
let rulesetsDir: string;

beforeEach(async () => {
  rulesetsDir = mkdtempSync(join(tmpdir(), 'gol-rulesets-route-'));
  const app = createApp({ distDir: FIXTURE_DIST, version: '9.9.9-test', rulesetsDir });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(rulesetsDir, { recursive: true, force: true });
});

describe('GET /api/rulesets', () => {
  it('lists every builtin ruleset as a summary', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; name: string }>;
    expect(body.length).toBeGreaterThan(5);
    expect(body.find((r) => r.id === 'conway')?.name).toMatch(/Conway/i);
    // Summaries, not full documents -- no states/neighborhood/transition leaking through.
    expect(body[0]).not.toHaveProperty('states');
  });

  it('includes a saved user ruleset alongside the builtins', async () => {
    await fetch(`${baseUrl}/api/rulesets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID_RULE) });
    const res = await fetch(`${baseUrl}/api/rulesets`);
    const body = (await res.json()) as Array<{ id: string }>;
    expect(body.some((r) => r.id === 'user:my-cool-rule')).toBe(true);
  });
});

describe('GET /api/rulesets/:id', () => {
  it('returns a builtin ruleset in full', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/conway`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: string; states: unknown[] };
    expect(body.id).toBe('conway');
    expect(Array.isArray(body.states)).toBe(true);
  });

  it('returns a previously-saved user ruleset', async () => {
    await fetch(`${baseUrl}/api/rulesets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID_RULE) });
    const res = await fetch(`${baseUrl}/api/rulesets/user:my-cool-rule`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { name: string };
    expect(body.name).toBe('My Cool Rule');
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/user:does-not-exist`);
    expect(res.status).toBe(404);
  });

  it('returns 400, not 404 or 200, for a path-traversal id (all four routes, this case: GET by id)', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/..%2F..%2Fetc%2Fpasswd`);
    expect(res.status).toBe(400);
  });
});

describe('POST /api/rulesets', () => {
  it('stores a valid ruleset and returns { id }', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(VALID_RULE),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string };
    expect(body.id).toBe('user:my-cool-rule');
  });

  it('returns the structured issues[] array for an invalid ruleset (all four routes, this case: POST)', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ nonsense: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: Array<{ path: string; message: string }> };
    expect(Array.isArray(body.issues)).toBe(true);
    expect(body.issues.length).toBeGreaterThan(0);
    expect(body.issues[0]).toHaveProperty('path');
    expect(body.issues[0]).toHaveProperty('message');
  });

  it('rejects a path-traversal id with 400 (all four routes, this case: POST)', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_RULE, id: '../../etc/passwd' }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { issues: unknown[] };
    expect(Array.isArray(body.issues)).toBe(true);
  });

  it('rejects a body over the size limit', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID_RULE, description: 'x'.repeat(70_000) }),
    });
    expect(res.status).toBe(413);
  });

  it('concurrent writes to the same id never corrupt the stored file (atomic write via temp + rename)', async () => {
    const variants = Array.from({ length: 10 }, (_, i) => ({ ...VALID_RULE, description: `variant-${i}` }));
    await Promise.all(
      variants.map((v) =>
        fetch(`${baseUrl}/api/rulesets`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(v),
        }),
      ),
    );
    const res = await fetch(`${baseUrl}/api/rulesets/user:my-cool-rule`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { description: string };
    // Whichever write landed last, the file is always one complete, parseable JSON document --
    // never a torn write mixing two variants' bytes together.
    expect(body.description).toMatch(/^variant-\d$/);
  });
});

describe('DELETE /api/rulesets/:id', () => {
  it('deletes a user ruleset', async () => {
    await fetch(`${baseUrl}/api/rulesets`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(VALID_RULE) });
    const res = await fetch(`${baseUrl}/api/rulesets/user:my-cool-rule`, { method: 'DELETE' });
    expect(res.status).toBe(204);
    const getRes = await fetch(`${baseUrl}/api/rulesets/user:my-cool-rule`);
    expect(getRes.status).toBe(404);
  });

  it('refuses to delete a builtin ruleset (user rulesets only)', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/conway`, { method: 'DELETE' });
    expect(res.status).toBe(403);
    // Still there.
    expect((await fetch(`${baseUrl}/api/rulesets/conway`)).status).toBe(200);
  });

  it('returns 404 for a well-formed but unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/user:does-not-exist`, { method: 'DELETE' });
    expect(res.status).toBe(404);
  });

  it('rejects a path-traversal id with 400 (all four routes, this case: DELETE)', async () => {
    const res = await fetch(`${baseUrl}/api/rulesets/..%2F..%2Fetc%2Fpasswd`, { method: 'DELETE' });
    expect(res.status).toBe(400);
  });
});
