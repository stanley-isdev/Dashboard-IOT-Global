import { z } from 'zod';

/**
 * Deploy-time configuration, read from public/config/runtime-config.json before
 * React mounts.
 *
 * Why a fetched file rather than only Vite env vars: an env var is baked in at
 * build time, so changing the API URL would mean a rebuild. That is the wrong
 * handover story for a small IS team. Vite copies public/ verbatim, so the file
 * keeps a stable path and can be edited in Notepad on the server. One built
 * artifact then serves dev, UAT and production.
 *
 * The file MUST be served with no-cache. If it is cached, changing apiBaseUrl
 * appears to do nothing - the single most likely deploy failure here.
 */

/**
 * What a site may ask for as its opening theme. 'system' follows the viewer's OS
 * once, at boot - see `resolveTheme` in state/prefsStore.ts for why only once.
 */
export type ThemePref = 'light' | 'dark' | 'system';

export const zRuntimeConfig = z.object({
  apiBaseUrl: z.string(),
  refreshMs: z.number().int().positive(),
  requestTimeoutMs: z.number().int().positive(),
  /**
   * Null on a site with no public internet. The bundled Natural Earth vector
   * layer renders underneath regardless, so the map degrades to country
   * outlines instead of going grey.
   */
  tileUrl: z.string().nullable(),
  /**
   * The same basemap drawn for the dark theme. Optional, and falling back to
   * `tileUrl` when absent: a site that has not set it gets the light tiles under
   * a dark board, which is worse-looking but still a map, where refusing to draw
   * anything would lose the coastlines a viewer is using to place a pin.
   *
   * `.default(null)` rather than `.optional()` so the field is optional in the
   * *file* and always present in the parsed value - a deployed
   * runtime-config.json written before this field existed must keep validating,
   * or a version bump silently drops the whole config to FALLBACK_CONFIG.
   */
  tileUrlDark: z.string().nullable().default(null),
  tileAttribution: z.string(),
  grafanaBaseUrl: z.string(),
  defaultLang: z.enum(['th', 'en']),
  /** Opening theme for a viewer with no stored preference. Defaulted, as above. */
  defaultTheme: z.enum(['light', 'dark', 'system']).default('light'),
  kioskDefault: z.boolean(),
  /** Where the trend chart's single time axis is anchored (D-04). */
  referenceTimezone: z.string(),
  buildId: z.string(),
});

export type RuntimeConfig = z.infer<typeof zRuntimeConfig>;

/**
  * Used when the config file is missing or malformed. The app must still start -
 * a dashboard that white-screens because one JSON file has a trailing comma is
 * worse than one that starts against the default API path and says so in a
 * banner - which is what ConfigProblemBanner does with the `problem` below.
 */
export const FALLBACK_CONFIG: RuntimeConfig = {
  apiBaseUrl: '/api/v1',
  refreshMs: 30_000,
  requestTimeoutMs: 10_000,
  tileUrl: null,
  tileUrlDark: null,
  tileAttribution: '&copy; Natural Earth',
  grafanaBaseUrl: '',
  defaultLang: 'en',
  defaultTheme: 'light',
  kioskDefault: false,
  referenceTimezone: 'Asia/Bangkok',
  buildId: 'dev',
};

export interface LoadedConfig {
  config: RuntimeConfig;
  /** Set when the file could not be read or did not validate. Surfaced in the UI. */
  problem: string | null;
}

export async function loadRuntimeConfig(): Promise<LoadedConfig> {
  const url = `${import.meta.env.BASE_URL}config/runtime-config.json`;

  let raw: unknown;
  try {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) {
      return {
        config: FALLBACK_CONFIG,
        problem: `runtime-config.json returned HTTP ${res.status}`,
      };
    }
    raw = await res.json();
  } catch (err) {
    return {
      config: FALLBACK_CONFIG,
      problem: `runtime-config.json could not be read: ${(err as Error).message}`,
    };
  }

  const parsed = zRuntimeConfig.safeParse(raw);
  if (!parsed.success) {
    return {
      config: FALLBACK_CONFIG,
      problem: `runtime-config.json is invalid:\n${z.prettifyError(parsed.error)}`,
    };
  }

  /*
   * There is no `dataSource` any more, and no VITE_DATA_SOURCE override.
   *
   * Both existed to switch this app between a generated dataset and the real
   * API. The generator has gone - the backend grew the two endpoints it was
   * standing in for (server/src/routes/scope.ts) - and with one adapter left
   * there is nothing to choose between. `apiBaseUrl` is now the whole of "where
   * does the data come from", which is one question with one answer instead of
   * two that could disagree.
   *
   * The escape hatch it provided is not missed. Its purpose was a developer or
   * a demo with no route to the backend, and what they got was a build that
   * silently never called the API - a `.env.local` in the wrong place turned
   * `npm run build` into a demo artifact and nothing on screen said so. A dead
   * API is now a dead API on every build, and HardErrorState names which part
   * of it is dead.
   */
  return { config: parsed.data, problem: null };
}
