import { describe, expect, it } from 'vitest';
import { buildApp } from '../src/app.ts';
import { loadEnv } from '../src/config/env.ts';

describe('/healthz', () => {
  it('responds ok with a fresh timestamp', async () => {
    const app = await buildApp(loadEnv({ CORS_ORIGIN: 'http://localhost:5173' }));
    const res = await app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.status).toBe('ok');
    expect(new Date(body.now).getTime()).not.toBeNaN();
    await app.close();
  });
});
