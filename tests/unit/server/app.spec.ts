import { readFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '@server/app';
import type { Server } from 'node:http';

const PACKAGE_JSON_PATH = fileURLToPath(new URL('../../../package.json', import.meta.url));
const PACKAGE_VERSION = (JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8')) as { version: string }).version;

const FIXTURE_DIST = fileURLToPath(new URL('../../fixtures/server/dist-client', import.meta.url));
const FIXTURE_DIST_NO_INDEX = fileURLToPath(new URL('../../fixtures/server/dist-client-no-index', import.meta.url));
const VERSION = '9.9.9-test';

async function withApp<T>(distDir: string, fn: (baseUrl: string) => Promise<T>): Promise<T> {
  const app = createApp({ distDir, version: VERSION });
  const s = app.listen(0);
  await new Promise<void>((resolve) => s.once('listening', resolve));
  const { port } = s.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
  }
}

let server: Server;
let baseUrl: string;

beforeEach(async () => {
  const app = createApp({ distDir: FIXTURE_DIST, version: VERSION });
  server = app.listen(0);
  await new Promise<void>((resolve) => server.once('listening', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close((err) => (err ? reject(err) : resolve())));
});

describe('GET /api/health', () => {
  it('returns { ok: true, version, uptime } matching the configured version', async () => {
    const res = await fetch(`${baseUrl}/api/health`);
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);

    const body = (await res.json()) as { ok: boolean; version: string; uptime: number };
    expect(body.ok).toBe(true);
    expect(body.version).toBe(VERSION);
    expect(typeof body.uptime).toBe('number');
    expect(body.uptime).toBeGreaterThanOrEqual(0);
  });

  it("defaults version to package.json's own version when none is configured", async () => {
    const app = createApp({ distDir: FIXTURE_DIST });
    const s = app.listen(0);
    await new Promise<void>((resolve) => s.once('listening', resolve));
    const { port } = s.address() as AddressInfo;
    try {
      const res = await fetch(`http://127.0.0.1:${port}/api/health`);
      const body = (await res.json()) as { version: string };
      expect(body.version).toBe(PACKAGE_VERSION);
    } finally {
      await new Promise<void>((resolve, reject) => s.close((err) => (err ? reject(err) : resolve())));
    }
  });
});

describe('createApp() options', () => {
  it('defaults distDir to dist/client (no throw at construction time, even if unbuilt)', () => {
    expect(() => createApp()).not.toThrow();
  });
});

describe('static asset serving', () => {
  it('serves a hashed asset under assets/ with a long, immutable Cache-Control', async () => {
    const res = await fetch(`${baseUrl}/assets/app-deadbeef.js`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toContain('fixture');
  });

  it('leaves a non-hashed root-level static file without the immutable Cache-Control', async () => {
    const res = await fetch(`${baseUrl}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).not.toBe('public, max-age=31536000, immutable');
    expect(await res.text()).toContain('User-agent');
  });
});

describe('SPA shell fallback', () => {
  it('serves index.html with Cache-Control: no-store for an unknown non-API path', async () => {
    const res = await fetch(`${baseUrl}/some/deep/client-route`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(res.headers.get('content-type')).toMatch(/text\/html/);
    expect(await res.text()).toContain('fixture shell');
  });

  it('serves index.html with the same no-store treatment at the root path', async () => {
    const res = await fetch(`${baseUrl}/`);
    expect(res.status).toBe(200);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).toContain('fixture shell');
  });
});

describe('unknown /api/* paths', () => {
  it('returns a JSON 404, not the HTML shell', async () => {
    const res = await fetch(`${baseUrl}/api/does-not-exist`);
    expect(res.status).toBe(404);
    expect(res.headers.get('content-type')).toMatch(/application\/json/);
    expect(await res.json()).toEqual({ error: 'not found' });
  });
});

describe('a distDir with no index.html (a broken or incomplete build)', () => {
  it('falls back to a JSON 404 instead of letting sendFile error out unhandled', async () => {
    await withApp(FIXTURE_DIST_NO_INDEX, async (base) => {
      const res = await fetch(`${base}/anything`);
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'not found' });
    });
  });
});
