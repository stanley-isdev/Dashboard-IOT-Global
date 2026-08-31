import type { ResolvedShift } from '@dashboard/domain-shared';

/**
 * DESIGN.md §8.4's **`Order End` layer 2**, ported from the panel source now
 * recorded in docs/grafana/MACHINE-STATUS-V2.md §4.2.
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
 * Applied to live THS data it moves 2 machines of 15, not 15 of 15: `I5` and
 * `IC5` both carry orders created 2026-08-26 13:06 UTC - 20:06 Bangkok, the
 * previous night shift. Avg %OA goes 75.2% -> **81.0%**, which is the board.
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
 * Values are **UTC** - stated in the panel's own comment ("dtStr ... is UTC
 * now") and the reason its JavaScript appends a literal `Z` before parsing.
 * Anything zone-less here is therefore read as UTC, never as server-local time.
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
 */
export function parseCreateDate(raw: string | null | undefined): Date | null {
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
  const at = Date.UTC(+y, +mo - 1, +d, +h, +mi, s ? +s : 0);
  return Number.isNaN(at) ? null : new Date(at);
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

  const parsed = createdRaw.map(parseCreateDate).filter((d): d is Date => d !== null);
  if (parsed.length === 0) return 'unknown';

  const from = shift.startUtc.getTime();
  const to = shift.endUtc.getTime();
  // Half-open, so an order created exactly on the boundary belongs to the shift
  // that started then and not to both.
  return parsed.some((d) => d.getTime() >= from && d.getTime() < to) ? 'current' : 'ended';
}
