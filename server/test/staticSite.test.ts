import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';

/**
 * A stand-in for `dist/`, built in a temp directory rather than pointed at the
 * real one: the real `dist/` may or may not exist when the suite runs, and a
 * test whose result depends on whether somebody ran `npm run build` first is
 * not a test.
 */
let root: string;

const INDEX_HTML = '<!doctype html><title>Dashboard</title><div id="root"></div>';
const RUNTIME_CONFIG = '{"apiBaseUrl":"/api/v1"}';

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'dashboard-static-'));
  await mkdir(join(root, 'assets'));
  await mkdir(join(root, 'config'));
  await writeFile(join(root, 'index.html'), INDEX_HTML);
  await writeFile(join(root, 'config', 'runtime-config.json'), RUNTIME_CONFIG);
  await writeFile(join(root, 'assets', 'index-D9WpcydM.js'), 'console.log(1)');
  await writeFile(join(root, 'favicon-32.png'), 'not really a png');
});

afterAll(async () => {
  await rm(root, { recursive: true, force: true });
});

const envWithStatic = () =>
  loadEnv({ CORS_ORIGIN: 'http://localhost:5173', STATIC_DIR: root });

describe('static site', () => {
  it('serves the shell at the root', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
    await app.close();
  });

  it('serves the shell for a client-side route, so a deep link survives a refresh', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/companies/ASI' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
    await app.close();
  });

  it('keeps a query string off the fallback decision', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/companies/ASI?zone=1' });
    expect(res.statusCode).toBe(200);
    expect(res.body).toBe(INDEX_HTML);
    await app.close();
  });

  /*
   * The two things the fallback must not swallow. Both would "work" in the
   * sense of returning 200, and both would move the failure somewhere that
   * names the wrong cause.
   */
  it('answers an unknown API path with JSON, not the shell', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/api/v1/does-not-exist' });
    expect(res.statusCode).toBe(404);
    expect(res.headers['content-type']).toContain('application/json');
    expect(res.json().error).toBe('Not Found');
    await app.close();
  });

  it('answers a missing hashed asset with 404, not the shell', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/assets/index-GONE1234.js' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toBe(INDEX_HTML);
    await app.close();
  });

  it('does not answer a non-GET with the shell', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'POST', url: '/companies/ASI' });
    expect(res.statusCode).toBe(404);
    expect(res.body).not.toBe(INDEX_HTML);
    await app.close();
  });

  it('leaves the API and the health probe reachable', async () => {
    const app = await buildApp(envWithStatic());

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);
    expect(health.json().status).toBe('ok');

    const meta = await app.inject({ method: 'GET', url: '/api/v1/meta' });
    expect(meta.statusCode).toBe(200);
    expect(meta.headers['content-type']).toContain('application/json');

    await app.close();
  });
});

describe('static site caching', () => {
  /*
   * The first of these is the one that costs a site visit when it is wrong:
   * runtime-config.json is edited in place on the server, and a cached copy
   * means the edit silently does not land.
   */
  it('serves runtime-config.json and the shell no-cache', async () => {
    const app = await buildApp(envWithStatic());

    const config = await app.inject({ method: 'GET', url: '/config/runtime-config.json' });
    expect(config.statusCode).toBe(200);
    expect(config.body).toBe(RUNTIME_CONFIG);
    expect(config.headers['cache-control']).toBe('no-cache');

    const shell = await app.inject({ method: 'GET', url: '/index.html' });
    expect(shell.headers['cache-control']).toBe('no-cache');

    await app.close();
  });

  it('pins hashed assets for a year', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/assets/index-D9WpcydM.js' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=31536000, immutable');
    await app.close();
  });

  it('gives unhashed public files an hour', async () => {
    const app = await buildApp(envWithStatic());
    const res = await app.inject({ method: 'GET', url: '/favicon-32.png' });
    expect(res.statusCode).toBe(200);
    expect(res.headers['cache-control']).toBe('public, max-age=3600');
    await app.close();
  });
});

describe('without STATIC_DIR', () => {
  /*
   * The API-only shape every other test file in this suite runs against. Worth
   * asserting rather than assuming: it is what keeps adding this plugin from
   * having quietly changed 218 existing tests.
   */
  it('serves no site and keeps the default 404', async () => {
    const app = await buildApp(loadEnv({ CORS_ORIGIN: 'http://localhost:5173' }));

    const root = await app.inject({ method: 'GET', url: '/' });
    expect(root.statusCode).toBe(404);

    const health = await app.inject({ method: 'GET', url: '/healthz' });
    expect(health.statusCode).toBe(200);

    await app.close();
  });
});
