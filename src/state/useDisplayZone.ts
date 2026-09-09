import { useCallback } from 'react';
import { useConfig } from '../config/AppContext';
import { usePrefs, type TimeMode } from './prefsStore';

/**
 * Which clock a timestamp is printed on, for the whole board.
 *
 * This is where the `timeMode` toggle in TimeRangePicker reaches. Before it
 * existed the toggle moved a footer sentence and an offset badge and nothing
 * else: TrendChart, DataQualityFooter, ConnectionBanner and ExportButton were
 * hardwired to the reference zone while RankingTable, BaseDrawer and the
 * ShiftChips were hardwired to `company.timezone`. So the board mixed two
 * clocks in both modes, and the footer announced whichever one happened to be
 * wrong for the half you were looking at.
 *
 * The rule, and it is the same rule the capsule's offset badge already used:
 *
 *   - A timestamp that BELONGS to a site follows the mode. `site_local` prints
 *     it on that site's clock; `fixed` and `viewer` print the same instant on
 *     one chosen zone - a picked one, or the reader's own.
 *   - A timestamp that belongs to the fleet or to the backend - when the
 *     snapshot was generated, when a request failed, when the PDF was made -
 *     has no site clock to fall back to. Passing no zone is how a caller says
 *     so, and it is a decision rather than an oversight: nine bases span UTC+01
 *     to UTC-06 and there is no honest local reading of "the server built this
 *     payload at". `site_local` therefore leaves it on the reference zone.
 *
 *     `viewer` is the one mode that DOES move it, and deliberately: the reader
 *     has a clock even when the fleet has none, so "built at 15:04 your time"
 *     is meaningful where "15:04 at some base" is not.
 *
 * Two exceptions, and both are cases where the rule above would destroy the
 * thing being read rather than re-express it:
 *
 *   - The ranking's Date/Time column is always `company.timezone`, in every
 *     mode. That column exists to answer "what time is it there" for nine bases
 *     at once; resolving it here put all nine rows on one clock and left nine
 *     identical readings. It is the only place the fleet's spread is visible.
 *   - The overview's TrendChart stays on the reference zone. Its x-axis is one
 *     line of hourly buckets aggregated ACROSS all nine bases, so there is no
 *     site clock available and no reader's clock that would make the buckets
 *     line up any better. Its axis legend names the zone it drew, which is what
 *     keeps that honest.
 *
 * Anything pre-formatted upstream is a third failure mode and not an exception,
 * because nothing here can repair it: a formatted timestamp has already thrown
 * away the offset needed to re-zone it. The hourly table's column heads were
 * exactly that - a `label` string the API baked in the site's zone - and the
 * fix was to delete the field and format from the instants instead, not to add
 * a case here. See zOutputBucket. Payloads carry instants; the UI carries
 * clocks.
 *
 * What does NOT move is the arithmetic. Shift windows are still cut on each
 * site's own shift, `production_date` is still that site's production date, and
 * every figure on the board is the figure it was before the toggle was touched.
 * Only the reading of the clock beside them changes - which is exactly what
 * the panel footer's own sentence promises in every mode.
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
  viewerTimezone?: string | null,
  fixedZone?: string | null,
): string {
  /*
   * `fixed` replaced a dedicated `reference` mode on 2026-09-09. "HQ time" was
   * one hardcoded zone and a button of its own; a list of zones subsumes it -
   * picking Asia/Bangkok is the same reading - and also answers "let me hold
   * this against Tokyo for a minute", which the old pair could not.
   *
   * Falls back to the reference zone on a blank, so a reader who has not
   * chosen yet gets the deployment's clock rather than a RangeError.
   */
  if (timeMode === 'fixed') return fixedZone ? fixedZone : referenceTimezone;
  /*
   * `viewer` prints every timestamp on the reader's own clock, wherever they
   * are - the mode a colleague in Japan asked for, so a Thai plant's stop reads
   * in JST rather than making them add seven hours in their head.
   *
   * It applies to fleet-wide timestamps too, unlike `site_local`. A snapshot
   * generation time has no site clock to fall back to, but it does have the
   * reader's, and "this payload was built at 15:04 your time" is meaningful
   * where "15:04 at some base" would not be.
   *
   * Falls back rather than trusting the browser blindly: `resolvedOptions()`
   * can return undefined in older engines and an unrecognised zone in a
   * misconfigured one, and Intl throws a RangeError on either.
   */
  if (timeMode === 'viewer') return viewerTimezone ? viewerTimezone : referenceTimezone;
  /* An empty string counts as absent, not as a zone. `company.timezone` is
     required by the contract, but a base mid-commissioning has been served with
     fields the schema calls strings and the master data has not filled in yet,
     and Intl throws a RangeError on '' rather than falling back. */
  return siteTimezone ? siteTimezone : referenceTimezone;
}

/**
 * The reader's own zone, or `null` when the browser will not say.
 *
 * Read once per render rather than cached in a module: a laptop carried across
 * a timezone, or an OS clock corrected, should be picked up without a reload,
 * and the call is cheap enough that pinning it buys nothing.
 */
export function viewerTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

/** The rule above, bound to what the reader has currently chosen. */
export function useDisplayZone(): (siteTimezone?: string | null) => string {
  const timeMode = usePrefs((s) => s.timeMode);
  const fixedZone = usePrefs((s) => s.fixedZone);
  const { referenceTimezone } = useConfig();
  const viewer = viewerTimeZone();

  return useCallback(
    (siteTimezone) =>
      resolveDisplayZone(timeMode, referenceTimezone, siteTimezone, viewer, fixedZone),
    [timeMode, referenceTimezone, viewer, fixedZone],
  );
}
