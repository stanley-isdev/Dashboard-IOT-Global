import { zonedToUtc, type ResolvedShift } from '@dashboard/domain-shared';

/**
 * DESIGN.md §8.4's **`Order End` layer 2**, ported from the panel source
 * recorded in docs/grafana/MACHINE-STATUS-V2.md §4.2 (captured 2026-08-27).
 *
 * **STALE AS OF 2026-09-10 - the live panel no longer contains this layer at
 * all.** The SQL and `afterRender` JS pulled from the panel that day (see
 * docs/grafana/MACHINE-STATUS-V2.md §0) have zero shift comparison anywhere -
 * not `getProductionShiftInfo`, not `isCurrentShift`, no `now()` against
 * `vCreateDateTxt` in the SQL either. What replaced it is a manually-set
 * `Pending`/`Order End` written to `production_machine_status.Result` by
 * Node-RED when an operator presses a widget button - not a timestamp guess.
 * This function's verdict is therefore not a description of what the
 * production board does today; do not cite it as one (the warnings it feeds
 * used to, and that wording needs fixing - see `oaWarnings`'s caller). Left in
 * place because removing it would remove nothing load-bearing: since
 * 2026-09-08 it only reports, never excludes (see below).
 *
 * ## What it does
 *
 * A machine can still be `Mass Pro` while the order it has loaded belongs to a
 * shift that has already ended - the operator has not started the next one yet.
 * The production board detects that by comparing the order's creation timestamp
 * against the current production shift, and when it does not match it **blanks
 * that card's figures** (`%OA -> 0`, output -> 0) and shows the finished order
 * on a second card labelled `Order End`.
 *
 * The blanked zero then falls out of the board's average, because its
 * `avgOA` accumulator only takes cards with `oaVal > 0`. So the visible effect
 * of layer 2 on the numbers an executive reads is exactly one thing: **the
 * machine leaves the %OA denominator.** It does NOT change Total, Running or
 * Stop - the original card keeps its real status.
 *
 * ## What THIS port does with the verdict - and it is not that
 *
 * **The verdict is reported. It excludes nothing. Design owner, 2026-09-08.**
 *
 * The board's inference - order created before this shift, therefore finished -
 * holds at THS, which creates an order per shift, and fails at ASI, which runs
 * one order across days. Applied there on 2026-09-08 it blanked the plant
 * outright: seven machines with a computable %OA averaging 75.0%, all of them
 * still shooting that minute, all of them ruled `ended` because their orders
 * were created the previous morning.
 *
 * So the rule keeps its judgement and loses its authority to act on it. An
 * order is finished when its `ProductionOrderN` slots clear, which the gateway
 * says plainly and needs no inferring; until then the machine stays in the
 * average. What the verdict is still for is `orderShiftWarnings`, which names
 * the carried-over machines so a reader can see exactly why this board and the
 * production board can disagree.
 *
 * ## Why BACKEND-HANDOVER §4.5(c) said this was impossible
 *
 * That section concluded layer 2 "can never match" and that "a literal reading
 * marks every machine `Order End` and collapses Running to near zero". Three
 * things it could not know without the panel source, all now measured against
 * the live instance on 2026-08-27:
 *
 *   1. **The `-` rows are not a parsing problem, they are the skip condition.**
 *      The panel returns early unless the card has a real `ProductionOrder0`.
 *      The 51% of rows reading `"-"` are machines with no order loaded, which
 *      have no %OA to begin with. Nothing about them "collapses".
 *   2. **It never compares against a `YYYY-MM-DD` string.** It converts both
 *      sides to (production date, shift) with `Intl` in the site's zone. This
 *      port goes one better and does interval containment against
 *      `resolveShift`'s `startUtc`/`endUtc`, which is the same answer for a
 *      2-shift site and the *correct* one for STJ's 3 shifts and 22:15 boundary.
 *   3. **Both timestamp formats parse.** Measured shapes over 24 h at THS:
 *      `YYYY-MM-DD HH:MM:SS` (58), `YYYY/MM/DD HH:MM:SS` (4), `-` (226). The
 *      two real shapes differ only in separator.
 *
 * The 2026-08-27 measurement recorded here - `I5` and `IC5` "created 13:06 UTC
 * = 20:06 Bangkok, the previous night shift", moving Avg %OA 75.2% -> 81.0% to
 * match the board - was itself a product of the UTC misreading corrected in
 * `parseCreateDate` on 2026-09-08. Those two orders were raised at 13:06 local,
 * inside the day shift. The agreement with the board was agreement on a shared
 * mistake, not a reconciliation.
 */

/** Layer 2's verdict for one machine's loaded order. */
export type OrderShiftVerdict =
  /** At least one active slot was created inside the current shift. */
  | 'current'
  /** Every active slot parsed, and none of them lands in the current shift. */
  | 'ended'
  /** No slot could be read, so the question cannot be answered from this data. */
  | 'unknown';

/**
 * The two shapes `vCreateDateTxt` actually holds, plus anything already
 * carrying a zone marker.
 *
 * **A zone-less value is the site's local wall clock.** This file used to say
 * the opposite - "values are UTC", on the strength of the panel's own comment
 * ("dtStr ... is UTC now") and the literal `Z` its JavaScript appends before
 * parsing. That claim is wrong, and measurement settles it: see
 * `parseCreateDate` for the 400-row comparison against the row's own UTC `time`
 * column, where the deltas cap at exactly +7.00 h.
 *
 * Worth recording that the panel's comment is not incidental here - appending
 * `Z` to a local timestamp is precisely how the production board reaches its own
 * inflated %OA, and trusting that comment is how this port inherited the same
 * defect. A source's description of its data is a claim to be checked, not a
 * fact.
 */
const TIMESTAMP = /^(\d{4})[-/](\d{2})[-/](\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/;

/** What the slot holds when no order occupies it. */
const EMPTY = new Set(['', '-']);

/**
 * One `vCreateDateTxt` value as an instant, or `null` if it holds no date.
 *
 * Deliberately hand-parsed rather than handed to `new Date(...)`: the
 * slash-separated shape is not an ECMAScript date-time string, so `Date.parse`
 * of it is implementation-defined - V8 happens to accept it, which is exactly
 * the kind of agreement that survives right up until it is load-bearing.
 *
 * **A bare timestamp is the SITE'S wall clock, not UTC.** This read `Date.UTC`
 * until 2026-09-08 and nothing in the handover ever established the zone, so
 * the assumption went unexamined. Measured against the `time` column on the
 * same row - which is UTC, so it settles the question - over 400 rows at 6332:
 * 154 of them placed the create time in the FUTURE relative to the row that
 * carried it, and the deltas topped out at **exactly +7.00 h**. An order cannot
 * be created after the row recording it, and +7 is Bangkok. The digits are
 * local.
 *
 * What that cost: every create time landed 7 h late, so an order raised in the
 * afternoon fell outside the shift window and `orderShiftVerdict` called it
 * `ended`. The rule meant to catch the OLDEST orders was catching the NEWEST
 * ones - IA1 at 13:56 and P1I8 at 15:03, both `Mass Pro` and mid-cycle, both
 * ruled finished. And with the shift-based exclusion still live it inflated
 * THS's %OA to 88.8% against a true 83.3%, which is the figure the production
 * panel shows to this day (its own afterRender JavaScript reproduces the same
 * mistake - DESIGN.md §8.4 layer 2).
 *
 * `timeZone` is the site's, threaded from `ResolvedShift`, NOT a constant: STJ
 * is Asia/Tokyo and SEH is Europe/Budapest, which observes DST. `zonedToUtc`
 * resolves the offset at the instant in question rather than a fixed one.
 */
export function parseCreateDate(
  raw: string | null | undefined,
  timeZone: string,
): Date | null {
  if (raw == null) return null;
  // The panel's SQL URL-encodes spaces for the drill-down href; we read the
  // column raw, but a value that has been through that round trip still parses.
  const value = String(raw).replace(/%20/g, ' ').replace(/["']/g, '').trim();
  if (EMPTY.has(value) || value.toLowerCase() === 'no data') return null;

  // Already carries a zone marker - it says what it means, so believe it.
  if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(value)) {
    const d = new Date(value.replace(' ', 'T'));
    return Number.isNaN(d.getTime()) ? null : d;
  }

  const m = TIMESTAMP.exec(value);
  if (!m) return null;
  const [, y, mo, d, h, mi, s] = m;
  const at = zonedToUtc(
    { year: +y, month: +mo, day: +d, hour: +h, minute: +mi },
    timeZone,
  );
  if (Number.isNaN(at.getTime())) return null;
  // `zonedToUtc` works to the minute; the seconds ride along separately so a
  // boundary comparison is not quietly rounded down by up to 59 s.
  return new Date(at.getTime() + (s ? +s : 0) * 1000);
}

/**
 * Whether the order a machine has loaded belongs to the shift running now.
 *
 * `shift` is the site's own resolved shift, so a company on three shifts is
 * judged against its three and not against a hardcoded 08:00/20:00 - the split
 * the panel hardcodes and DESIGN.md §9.5 says is wrong for STJ.
 *
 * Returns `unknown` rather than guessing when there is no shift config or
 * nothing parseable: a machine dropped from an average for a reason nobody can
 * name is worse than one kept with a caveat.
 */
export function orderShiftVerdict(
  createdRaw: readonly (string | null)[],
  shift: ResolvedShift | null,
): OrderShiftVerdict {
  if (!shift) return 'unknown';

  const parsed = createdRaw
    .map((raw) => parseCreateDate(raw, shift.timeZone))
    .filter((d): d is Date => d !== null);
  if (parsed.length === 0) return 'unknown';

  const from = shift.startUtc.getTime();
  const to = shift.endUtc.getTime();
  // Half-open, so an order created exactly on the boundary belongs to the shift
  // that started then and not to both.
  return parsed.some((d) => d.getTime() >= from && d.getTime() < to) ? 'current' : 'ended';
}
