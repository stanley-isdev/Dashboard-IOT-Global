import { useEffect, useRef, useState } from 'react';
import type { Envelope, Freshness } from '../api/contract';
import { ageSeconds } from '../i18n/format';

/**
 * The four states of the data on screen, and one extra that catches the failure
 * mode nobody looks for.
 *
 *   cold       nothing has loaded yet          -> skeletons, never zeros
 *   live       fresh and current                -> normal
 *   stale      we have data, but not current    -> banner, numbers stay visible
 *   cold_fail  never loaded, and failing        -> error panel, NO numbers
 *
 * The stale case is the one section 14 of the design doc is really about:
 * "backend down -> banner and timestamp, never show 0 or a blank". The numbers
 * remain on screen because they are the last thing that was true; the banner and
 * the desaturation are what stop them being read as current.
 *
 * The extra case is `frozen`. A backend that keeps serving a cached payload
 * looks perfectly healthy from the client - 200 OK, fresh fetch, no error - while
 * the factory it describes has moved on. Checking `last_seen` does not catch it,
 * because `last_seen` is part of the frozen payload. The only tell is that
 * `generated_at` stops advancing, so that is what we watch.
 */

export type ConnectionState = 'cold' | 'live' | 'stale' | 'frozen' | 'cold_fail';

export interface ConnectionInfo {
  state: ConnectionState;
  /** Age of the snapshot in seconds, or null when nothing has loaded. */
  ageSec: number | null;
  /** `generated_at` of the payload on screen. */
  snapshotAt: string | null;
  /** True when the UI must dim the data region and flag it as not current. */
  degraded: boolean;
  /** Sources the backend told us are unavailable. */
  downSources: string[];
}

interface Input {
  envelope: Envelope | undefined;
  freshness: Freshness | undefined;
  isError: boolean;
  isPending: boolean;
  /** Ticks so the age recomputes without waiting for the next fetch. */
  nowMs: number;
}

const FREEZE_THRESHOLD = 3;

export function useFreezeDetector(generatedAt: string | undefined): boolean {
  const last = useRef<string | undefined>(undefined);
  const repeats = useRef(0);
  const [frozen, setFrozen] = useState(false);

  useEffect(() => {
    if (!generatedAt) return;
    if (generatedAt === last.current) {
      repeats.current += 1;
      if (repeats.current >= FREEZE_THRESHOLD) setFrozen(true);
    } else {
      last.current = generatedAt;
      repeats.current = 0;
      setFrozen(false);
    }
  }, [generatedAt]);

  return frozen;
}

/** A clock that ticks once a second, so ages stay honest between polls. */
export function useNow(intervalMs = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

export function deriveConnection(input: Input, frozen: boolean): ConnectionInfo {
  const { envelope, freshness, isError, isPending, nowMs } = input;

  if (!envelope) {
    return {
      state: isError && !isPending ? 'cold_fail' : 'cold',
      ageSec: null,
      snapshotAt: null,
      degraded: true,
      downSources: [],
    };
  }

  const age = ageSeconds(envelope.generated_at, nowMs);
  const downSources = envelope.sources.filter((s) => s.status !== 'ok').map((s) => s.name);

  // The freshness threshold comes from the backend's policy, never from a
  // constant in here. Acceptable silence differs by site and is a business
  // decision, not a UI one.
  const staleAfter = freshness?.stale_after_sec ?? 120;

  if (frozen) {
    return {
      state: 'frozen',
      ageSec: age,
      snapshotAt: envelope.generated_at,
      degraded: true,
      downSources,
    };
  }

  if (isError || age > staleAfter) {
    return {
      state: 'stale',
      ageSec: age,
      snapshotAt: envelope.generated_at,
      degraded: true,
      downSources,
    };
  }

  return {
    state: 'live',
    ageSec: age,
    snapshotAt: envelope.generated_at,
    degraded: envelope.partial,
    downSources,
  };
}
