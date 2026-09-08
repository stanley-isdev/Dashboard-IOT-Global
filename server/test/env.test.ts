import { describe, expect, it } from 'vitest';
import { loadEnv } from '../src/config/env.ts';

const base = { CORS_ORIGIN: 'http://localhost:5173' };

/**
 * `.env.example` ships every optional key present and empty, and says in as
 * many words that leaving them that way is supported. Node's --env-file turns
 * `KEY=` into an empty string rather than an absent key, so "supported" has to
 * be made true here rather than assumed.
 */
describe('loadEnv treats a blank value as absent', () => {
  it('accepts the blank InfluxDB block .env.example ships', () => {
    const env = loadEnv({ ...base, INFLUX_URL: '', INFLUX_DATABASE: '', INFLUX_TOKEN: '' });
    expect(env.INFLUX_URL).toBeUndefined();
    expect(env.INFLUX_DATABASE).toBeUndefined();
    expect(env.INFLUX_TOKEN).toBeUndefined();
  });

  it('accepts a blank STATIC_DIR as API-only', () => {
    expect(loadEnv({ ...base, STATIC_DIR: '' }).STATIC_DIR).toBeUndefined();
  });

  it('accepts the blank MSSQL block', () => {
    const env = loadEnv({ ...base, MSSQL_SERVER: '', MSSQL_DATABASE: '', MSSQL_USER: '', MSSQL_PASSWORD: '' });
    expect(env.MSSQL_SERVER).toBeUndefined();
    expect(env.MSSQL_PASSWORD).toBeUndefined();
  });

  it('treats whitespace as blank, because an editor can leave it behind', () => {
    expect(loadEnv({ ...base, INFLUX_URL: '   ' }).INFLUX_URL).toBeUndefined();
  });

  it('still passes real values through', () => {
    const env = loadEnv({ ...base, INFLUX_URL: 'http://10.0.0.1:8181', STATIC_DIR: 'C:\\app\\dist' });
    expect(env.INFLUX_URL).toBe('http://10.0.0.1:8181');
    expect(env.STATIC_DIR).toBe('C:\\app\\dist');
  });
});

describe('loadEnv still refuses what it should', () => {
  /* Blank-as-absent is for optional keys only. These two are the difference
     between a server that will not start and one pointed at nothing. */
  it('rejects a blank CORS_ORIGIN', () => {
    expect(() => loadEnv({ CORS_ORIGIN: '' })).toThrow(/CORS_ORIGIN/);
  });

  it('rejects a malformed INFLUX_URL rather than ignoring it', () => {
    expect(() => loadEnv({ ...base, INFLUX_URL: '10.0.0.1:8181' })).toThrow(/INFLUX_URL/);
  });

  it('rejects a PORT that is not a port', () => {
    expect(() => loadEnv({ ...base, PORT: 'eight thousand' })).toThrow(/PORT/);
  });
});
