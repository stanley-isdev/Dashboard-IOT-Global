import { useEffect, useRef, useState } from 'react';
import { isApiError, type ApiErrorKind } from '../api/ApiError';
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
  /**
   * Which kind of failure, when the state is `cold_fail`. Null otherwise, and
   * null for a thrown `Error` that never went through the adapter.
   *
   * It rides up here rather than staying inside the page because the shell has
   * one decision that depends on it: TopBar takes the filter row off a failed
   * board, since nothing in it can do anything - except on `timeout`, where the
   * time picker is the fix. See TopBar.
   */
  errorKind: ApiErrorKind | null;
}

interface Input {
  envelope: Envelope | undefined;
  freshness: Freshness | undefined;
  isError: boolean;
  isPending: boolean;
  /** The query's error, so `errorKind` can be published. Ignored when null. */
  error?: unknown;
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

/**
 * The end of an outage, and how long it lasted.
 *
 * The board could always say it was broken and could always say it was fine.
 * What it could not say is that it had *just been* broken - so a reader who
 * looked away for two minutes came back to a green Live badge with no way to
 * know the trend they were about to read has a hole in it. That hole is the
 * whole point of this: the notice exists to report the gap, not to celebrate
 * the recovery.
 */
export interface Recovery {
  /** Epoch ms when the board stopped being current. */
  since: number;
  /** How long it was not current, in seconds. */
  gapSec: number;
}

/**
 * Which states count as an outage worth reporting the end of.
 *
 * Only the two that mean "we had a payload and it stopped being current", and
 * the two that are missing are both deliberate.
 *
 * `cold` is not an outage: every visit begins in it, and counting it would pop
 * "not current for 2 seconds, so the trend has a gap" over a board that had
 * simply started up.
 *
 * `cold_fail` is not one either, and that is the less obvious half. It looks
 * like the worst outage of the three, but `deriveConnection` only ever returns
 * it while `envelope` is undefined - and with `gcTime: Infinity` and
 * `keepPreviousData` on every query, a payload that has arrived once never
 * leaves. So `cold_fail` can only precede the first success, never follow it:
 * `cold_fail -> live` is a first load that eventually worked, and the trend it
 * just loaded is complete. Announcing a three-minute hole in it would be a
 * fabricated fact about data that is perfectly whole.
 */
const OUTAGE: ReadonlySet<ConnectionState> = new Set(['stale', 'frozen']);

/** How long the notice stays before it takes itself off. */
const RECOVERY_NOTICE_MS = 8000;

/** What `stepRecovery` carries between transitions. */
export interface RecoveryState {
  /** When the current outage began, or null when there is not one. */
  outageSince: number | null;
  /** The notice to show, or null. */
  recovery: Recovery | null;
}

export const NO_RECOVERY: RecoveryState = { outageSince: null, recovery: null };

/**
 * The transition rule, as a pure function so it can be tested.
 *
 * Returns `current` by identity when the transition changes nothing, which is
 * what lets the hook skip a setState - and therefore a render - on the many
 * transitions that are not interesting.
 */
export function stepRecovery(
  current: RecoveryState,
  state: ConnectionState,
  nowMs: number,
): RecoveryState {
  if (OUTAGE.has(state)) {
    /* Stamped once per outage, not once per state change. A board that goes
       stale and then frozen has been out since it went stale - restamping
       would report the gap as the length of the last leg only.

       Nothing clears `recovery` here, and it does not need to: ConnectionBanner
       puts a live fault ahead of a past recovery, so a green notice can never
       be what is on screen while the board is degraded. */
    if (current.outageSince !== null) return current;
    return { ...current, outageSince: nowMs };
  }

  // `cold` falls through: still loading is not yet recovered.
  if (state !== 'live' || current.outageSince === null) return current;

  return {
    outageSince: null,
    recovery: {
      since: current.outageSince,
      gapSec: Math.round((nowMs - current.outageSince) / 1000),
    },
  };
}

/**
 * @param nowMs the page's own clock, from `useNow`. Passed in rather than read
 *   off `Date.now()` in here, for the same two reasons `deriveConnection` takes
 *   it: reading the wall clock during render is impure, and the board already
 *   has one clock whose tick is what every other age on screen is measured
 *   against. A gap reported to the nearest second by a different clock than the
 *   badge beside it is a gap somebody has to reconcile.
 */
export function useRecovery(state: ConnectionState, nowMs: number): Recovery | null {
  /*
   * Derived during render from the change in `state`, not from an effect.
   *
   * This is React's own "adjusting state when an input changes" pattern, and it
   * is the right shape here rather than the effect this started as: the notice
   * is a fact about a transition, so it has to be computed the moment the
   * transition is observed. Doing it in an effect meant a render in which the
   * board was live and the notice did not exist yet, then a second render to
   * add it - the cascading pair that react-hooks/set-state-in-effect exists to
   * stop, and on a board that re-renders once a second it is a pair per tick of
   * anything else that moves.
   *
   * Both values are state rather than refs, so nothing is mutated while
   * rendering. `prev` is the trigger and the guard: the block runs once per
   * change of `state` and never on the clock's ticks in between - which matters
   * on this board, because `nowMs` moves every second and the rule must be
   * evaluated against the moment the state changed, not the current one.
   */
  const [prev, setPrev] = useState<ConnectionState>(state);
  const [rec, setRec] = useState<RecoveryState>(NO_RECOVERY);

  if (prev !== state) {
    setPrev(state);
    const next = stepRecovery(rec, state, nowMs);
    // Identity, not deep equality: stepRecovery returns the same object when
    // the transition was not one of the interesting ones.
    if (next !== rec) setRec(next);
  }

  /*
   * Takes itself off.
   *
   * A success notice that stays is just another permanent badge, and this board
   * already has one of those saying the same thing - the Live capsule in the
   * masthead. Eight seconds is long enough to be read by somebody walking back
   * to the screen, which is the reader it is for.
   *
   * Keyed on the notice itself, so a second outage inside the window replaces
   * the first one's timer instead of inheriting it and vanishing early.
   */
  useEffect(() => {
    if (!rec.recovery) return;
    const id = setTimeout(
      /* Clears the notice and nothing else. `outageSince` is already null by
         the time a notice exists, and a functional update is what keeps this
         from capturing a stale `rec` across the eight seconds it waits. */
      () => setRec((r) => (r.recovery === null ? r : { ...r, recovery: null })),
      RECOVERY_NOTICE_MS,
    );
    return () => clearTimeout(id);
  }, [rec.recovery]);

  return rec.recovery;
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
  const { envelope, freshness, isError, isPending, error, nowMs } = input;

  if (!envelope) {
    const failed = isError && !isPending;
    return {
      state: failed ? 'cold_fail' : 'cold',
      ageSec: null,
      snapshotAt: null,
      degraded: true,
      downSources: [],
      errorKind: failed && isApiError(error) ? error.kind : null,
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
      // Not a failure: there is a payload on screen.
      errorKind: null,
    };
  }

  if (isError || age > staleAfter) {
    return {
      state: 'stale',
      ageSec: age,
      snapshotAt: envelope.generated_at,
      degraded: true,
      downSources,
      // Not a failure: there is a payload on screen.
      errorKind: null,
    };
  }

  return {
    state: 'live',
    ageSec: age,
    snapshotAt: envelope.generated_at,
    degraded: envelope.partial,
    downSources,
    // Not a failure: there is a payload on screen.
    errorKind: null,
  };
}
