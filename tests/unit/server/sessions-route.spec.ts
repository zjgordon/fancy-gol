import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from '@server/app';
import type { SessionDoc } from '@shared/session';

const FIXTURE_DIST = fileURLToPath(new URL('../../fixtures/server/dist-client', import.meta.url));

function doc(overrides: Partial<SessionDoc> = {}): SessionDoc {
  return {
    version: 1,
    ruleset: { kind: 'builtin', id: 'conway' },
    grid: 'x = 1, y = 1\no!',
    gridOrigin: { x: 0, y: 0 },
    tick: 0,
    seed: 1,
    camera: { originX: 0, originY: 0, cellSize: 16 },
    theme: 'default',
    toolState: { activeToolId: 'brush' },
    ...overrides,
  };
}

let server: Server;
let baseUrl: string;
let sessionsDir: string;

beforeEach(async () => {
  sessionsDir = mkdtempSync(join(tmpdir(), 'gol-sessions-route-'));
  const app = createApp({ distDir: FIXTURE_DIST, version: '9.9.9-test', sessionsDir });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
  rmSync(sessionsDir, { recursive: true, force: true });
});

describe('POST /api/sessions', () => {
  it('stores a valid document and returns { id, shareUrl }', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(doc()),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { id: string; shareUrl: string };
    expect(body.id).toMatch(/^[A-Za-z0-9_-]{6,32}$/);
    expect(body.shareUrl).toBe(`${baseUrl}/#s:${body.id}`);
  });

  it('rejects an invalid document with 400, never storing anything', async () => {
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ version: 1 }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: string };
    expect(body.error).toMatch(/invalid/i);
  });

  it('rejects a body over the size limit', async () => {
    const huge = doc({ grid: 'x'.repeat(11 * 1024 * 1024) });
    const res = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(huge),
    });
    expect(res.status).toBe(413);
  });
});

describe('GET /api/sessions/:id', () => {
  it('returns a previously-stored document', async () => {
    const stored = doc({ tick: 7, seed: 99 });
    const postRes = await fetch(`${baseUrl}/api/sessions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(stored),
    });
    const { id } = (await postRes.json()) as { id: string };

    const getRes = await fetch(`${baseUrl}/api/sessions/${id}`);
    expect(getRes.status).toBe(200);
    expect(getRes.headers.get('content-type')).toMatch(/application\/json/);
    await expect(getRes.json()).resolves.toEqual(stored);
  });

  it('returns 404 for an unknown id', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/doesnotexist`);
    expect(res.status).toBe(404);
  });

  it('returns 404, not a filesystem error, for a path-traversal attempt', async () => {
    const res = await fetch(`${baseUrl}/api/sessions/${encodeURIComponent('../../etc/passwd')}`);
    expect(res.status).toBe(404);
  });
});

describe('other /api/ routes are unaffected', () => {
  it('still 404s a made-up API path as JSON, not the SPA shell', async () => {
    const res = await fetch(`${baseUrl}/api/not-a-real-route`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
  });
});
