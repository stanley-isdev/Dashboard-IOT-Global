import type { Envelope, SourceHealth } from '@dashboard/contract';

/**
 * Builds the envelope block that rides on every response. `generated_at`
 * must be built fresh on every call, even when the underlying data came from
 * a cache - the frontend's freeze-detector (`FREEZE_THRESHOLD=3`) flags the
 * connection as worse than stale if this value is byte-identical across
 * three consecutive polls.
 */
export function buildEnvelope(opts: {
  sources: SourceHealth[];
  warnings?: string[];
  cacheAgeSec?: number;
}): Envelope {
  const sources = opts.sources;
  const partial = sources.some((s) => s.status !== 'ok');
  return {
    api_version: 'v1',
    generated_at: new Date().toISOString(),
    cache_age_sec: opts.cacheAgeSec,
    partial,
    warnings: opts.warnings ?? [],
    sources,
    build_id: process.env.BUILD_ID ?? 'dev',
  };
}
