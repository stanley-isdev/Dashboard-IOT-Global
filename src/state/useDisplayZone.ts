import { useCallback } from 'react';
import { useConfig } from '../config/AppContext';
import { usePrefs, type TimeMode } from './prefsStore';

/**
 * Which clock a timestamp is printed on, for the whole board.
 *
 * This is the one place the `timeMode` toggle in TimeRangePicker actually
 * reaches. Before it existed the toggle moved a footer sentence and an offset
 * badge and nothing else: TrendChart, DataQualityFooter, ConnectionBanner and
 * ExportButton were hardwired to the reference zone while RankingTable,
 * BaseDrawer and the ShiftChips were hardwired to `company.timezone`. So the
 * board mixed two clocks in both modes, and the footer announced whichever one
 * happened to be wrong for the half you were looking at.
 *
 * The rule, and it is the same rule the capsule's offset badge already used:
 *
 *   - A timestamp that BELONGS to a site follows the mode. Site local prints it
 *     on that site's clock; HQ prints the same instant on the reference zone.
 *   - A timestamp that belongs to the fleet or to the backend - when the
 *     snapshot was generated, when a request failed, when the PDF was made -
 *     has no site clock to fall back to and stays on the reference zone in both
 *     modes. Passing no zone is how a caller says so, and it is a decision
 *     rather than an oversight: nine bases span UTC+01 to UTC-06 and there is
 *     no honest local reading of "the server built this payload at".
 *
 * What does NOT move is the arithmetic. Shift windows are still cut on each
 * site's own shift, `production_date` is still that site's production date, and
 * every figure on the board is the figure it was before the toggle was touched.
 * Only the reading of the clock beside them changes - which is exactly what
 * `time.referenceNote` and `time.siteLocalNote` promise in the panel footer.
 *
 * Split into a pure rule and a hook that binds it: the rule is the part worth
 * pinning in a test, and the test suite here runs in plain node with no DOM.
 *
 * The hook returns a resolver rather than a zone because the callers that need it
 * most - a ranking table of nine rows, a drawer that re-reads its base out of
 * the payload on every poll - resolve a different zone per row and cannot call
 * a hook in a loop. It is `useCallback`-stable so the memoised charts and
 * tables downstream do not re-render on every tick of the clock.
 */
export function resolveDisplayZone(
  timeMode: TimeMode,
  referenceTimezone: string,
  siteTimezone?: string | null,
): string {
  if (timeMode === 'reference') return referenceTimezone;
  /* An empty string counts as absent, not as a zone. `company.timezone` is
     required by the contract, but a base mid-commissioning has been served with
     fields the schema calls strings and the master data has not filled in yet,
     and Intl throws a RangeError on '' rather than falling back. */
  return siteTimezone ? siteTimezone : referenceTimezone;
}

/** The rule above, bound to what the reader has currently chosen. */
export function useDisplayZone(): (siteTimezone?: string | null) => string {
  const timeMode = usePrefs((s) => s.timeMode);
  const { referenceTimezone } = useConfig();

  return useCallback(
    (siteTimezone) => resolveDisplayZone(timeMode, referenceTimezone, siteTimezone),
    [timeMode, referenceTimezone],
  );
}
