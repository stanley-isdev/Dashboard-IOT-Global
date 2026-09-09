import { afterEach, describe, expect, it, vi } from 'vitest';
import { FALLBACK_CONFIG, loadRuntimeConfig } from './runtimeConfig';

/**
 * Loading the deployed configuration.
 *
 * This file used to be about the data-source switch - `VITE_DATA_SOURCE`
 * overriding the file's `dataSource` - and every case here was a way that
 * override could go wrong. Both are gone: the generated dataset went with the
 * backend growing the endpoints it stood in for, and with one adapter left
 * there is nothing to switch between.
 *
 * What survived is the behaviour that still decides whether the board starts at
 * all. `runtime-config.json` is edited on the server after deploy, so it is the
 * one input nobody type-checks before it ships, and a dashboard that
 * white-screens over a trailing comma is worse than one that starts on defaults
 * and says so. `problem` is what ConfigProblemBanner puts on screen.
 */

/** A file that validates, so a failure can only come from the loader itself. */
const FILE = {
  apiBaseUrl: '/api/v1',
  refreshMs: 5000,
  requestTimeoutMs: 10_000,
  tileUrl: null,
  tileUrlDark: null,
  tileAttribution: '&copy; Natural Earth',
  grafanaBaseUrl: 'http://10.200.129.66:3000',
  defaultLang: 'en',
  defaultTheme: 'dark',
  kioskDefault: false,
  referenceTimezone: 'Asia/Bangkok',
  buildId: 'dev',
};

function serve(body: unknown, ok = true): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      status: ok ? 200 : 404,
      json: async () => body,
    })),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('loadRuntimeConfig', () => {
  it('uses the deployed file', async () => {
    // The production path: whoever edits runtime-config.json on the server wins,
    // with no build-time input of any kind.
    serve(FILE);

    const { config, problem } = await loadRuntimeConfig();

    expect(problem).toBeNull();
    expect(config.apiBaseUrl).toBe('/api/v1');
    expect(config.grafanaBaseUrl).toBe('http://10.200.129.66:3000');
    expect(config.refreshMs).toBe(5000);
  });

  it('starts on the defaults, and says so, when the file cannot be read', async () => {
    serve(null, false);

    const { config, problem } = await loadRuntimeConfig();

    expect(config).toEqual(FALLBACK_CONFIG);
    expect(problem).toMatch(/HTTP 404/);
  });

  it('starts on the defaults, and names the field, when the file is invalid', async () => {
    // The realistic failure: somebody edits the file on the server and fat-fingers
    // a value. The banner has to name what is wrong, not just that something is.
    serve({ ...FILE, refreshMs: 'every 5 seconds' });

    const { config, problem } = await loadRuntimeConfig();

    expect(config).toEqual(FALLBACK_CONFIG);
    expect(problem).toMatch(/refreshMs/);
  });

  /**
   * `FILE` is deliberately a file written before `windowedRequestTimeoutMs`
   * existed - which is what every already-deployed runtime-config.json is. A
   * version bump must not turn one of those into a config problem and drop the
   * whole board to FALLBACK_CONFIG over a field nobody has heard of yet.
   */
  it('fills in a field the deployed file has never heard of', async () => {
    serve(FILE);
    const { config, problem } = await loadRuntimeConfig();
    expect(problem).toBeNull();
    expect(config.windowedRequestTimeoutMs).toBe(FALLBACK_CONFIG.windowedRequestTimeoutMs);
  });

  it('never reports a problem it has not got', async () => {
    serve(FILE);
    const { problem } = await loadRuntimeConfig();
    expect(problem).toBeNull();
  });
});
