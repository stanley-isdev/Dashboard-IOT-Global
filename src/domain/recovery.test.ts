import { describe, expect, it } from 'vitest';
import { NO_RECOVERY, stepRecovery, type RecoveryState } from './connectionState';

/**
 * The rule behind the "connection restored" notice.
 *
 * Tested as a pure function rather than through the hook because the hook is
 * three lines of React around this and the interesting behaviour is all here:
 * which states start an outage, which one ends it, and - the two that actually
 * bit during review - which transitions must produce nothing at all.
 *
 * The clock is passed in, so every case below is exact rather than timing
 * dependent. See useRecovery for why nowMs is a parameter.
 */

const T0 = 1_757_000_000_000; // an arbitrary fixed epoch, in ms
const MIN = 60_000;

/** Walks a sequence of [state, atMs] pairs through the reducer. */
function run(steps: readonly [Parameters<typeof stepRecovery>[1], number][]): RecoveryState {
  return steps.reduce<RecoveryState>((acc, [state, at]) => stepRecovery(acc, state, at), NO_RECOVERY);
}

describe('stepRecovery', () => {
  it('reports the gap when a stale board goes live again', () => {
    const out = run([
      ['live', T0],
      ['stale', T0 + MIN],
      ['live', T0 + 5 * MIN],
    ]);

    expect(out.recovery).toEqual({ since: T0 + MIN, gapSec: 240 });
    // Cleared, so a second outage measures itself from its own start.
    expect(out.outageSince).toBeNull();
  });

  it('measures from the start of the outage, not from its last leg', () => {
    // A board that goes stale and then frozen has been out since it went
    // stale. Restamping on `frozen` would report four minutes as one.
    const out = run([
      ['live', T0],
      ['stale', T0 + MIN],
      ['frozen', T0 + 4 * MIN],
      ['live', T0 + 5 * MIN],
    ]);

    expect(out.recovery).toEqual({ since: T0 + MIN, gapSec: 240 });
  });

  it('says nothing when a first load finally succeeds', () => {
    /*
     * The case that made `cold_fail` come out of the outage set.
     *
     * deriveConnection only returns cold_fail while there is no envelope, and
     * with gcTime: Infinity a payload that arrives never leaves - so this
     * sequence is a first load that failed for three minutes and then worked.
     * The trend it just loaded is complete, and announcing a hole in it would
     * be a fabricated fact about whole data.
     */
    const out = run([
      ['cold', T0],
      ['cold_fail', T0 + 10_000],
      ['live', T0 + 3 * MIN],
    ]);

    expect(out.recovery).toBeNull();
  });

  it('says nothing on an ordinary first load', () => {
    expect(run([['cold', T0], ['live', T0 + 2000]]).recovery).toBeNull();
  });

  it('does not end an outage on the way through cold', () => {
    // `cold` is neither an outage nor a recovery. A refetch that briefly
    // reports pending must not close the notice's window early.
    const mid = run([
      ['live', T0],
      ['stale', T0 + MIN],
      ['cold', T0 + 2 * MIN],
    ]);

    expect(mid.recovery).toBeNull();
    expect(mid.outageSince).toBe(T0 + MIN);

    expect(stepRecovery(mid, 'live', T0 + 3 * MIN).recovery).toEqual({
      since: T0 + MIN,
      gapSec: 120,
    });
  });

  it('returns the same object when a transition changes nothing', () => {
    // Identity is what lets the hook skip a setState, and therefore a render,
    // on the transitions that are not interesting.
    const stale = stepRecovery(NO_RECOVERY, 'stale', T0);

    expect(stepRecovery(stale, 'frozen', T0 + MIN)).toBe(stale);
    expect(stepRecovery(NO_RECOVERY, 'live', T0)).toBe(NO_RECOVERY);
    expect(stepRecovery(NO_RECOVERY, 'cold', T0)).toBe(NO_RECOVERY);
  });

  it('reports each outage separately', () => {
    const first = run([
      ['live', T0],
      ['stale', T0 + MIN],
      ['live', T0 + 2 * MIN],
    ]);
    expect(first.recovery).toEqual({ since: T0 + MIN, gapSec: 60 });

    const second = stepRecovery(
      stepRecovery(first, 'stale', T0 + 10 * MIN),
      'live',
      T0 + 12 * MIN,
    );
    expect(second.recovery).toEqual({ since: T0 + 10 * MIN, gapSec: 120 });
  });
});
