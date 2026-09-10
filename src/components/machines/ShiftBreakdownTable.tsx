import type { ShiftBreakdown } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { formatClock, formatInt, formatPct } from '../../i18n/format';

/**
 * Output by shift.
 *
 * This table is the main reason the company page earns its place: it is where
 * the n-shift model from section 9.5 becomes visible. Seeing "A 06:00-14:00"
 * next to "B 14:00-22:15" is what stops someone comparing a THS twelve-hour
 * shift total against an STJ eight-hour one and reading the difference as
 * performance.
 *
 * Rows come from the shift config, so two, three or five shifts all render
 * without a code change. Shifts that have not started show a dash rather
 * than a zero, and the one in progress is labelled - otherwise a shift showing
 * 45.9% achievement at 15:42 reads as a failure instead of as half-done.
 *
 * ## The identity cell
 *
 * It carries four facts - which shift, which of how many, what hours, what
 * state - and it used to stack them as three full-width lines inside a column
 * the fixed layout gave a flat 25% of. At that width "08:00-20:00 · 12h" wrapped
 * as well, so a two-shift pattern drew eight lines of 11px caption at
 * --lh-tight, none of them separated by anything, and the reader had no way to
 * tell where one shift's block ended and the next began.
 *
 * The cut here is by rank rather than by fact: what the shift IS (label, its
 * place in the pattern, whether it is running) on one line, and the span it
 * covers under it. Two lines, a gap between them, and a colgroup that gives the
 * column the width the line actually needs - see the shares below.
 */
export function ShiftBreakdownTable({
  rows,
  timeZone,
}: {
  rows: ShiftBreakdown[];
  timeZone: string;
}) {
  const { t, lang } = useI18n();

  if (rows.length === 0) {
    return <p style={{ color: 'var(--sub)' }}>{t('shift.notConfigured')}</p>;
  }

  const dash = <span style={{ color: 'var(--status-nodata-ink)' }}>-</span>;

  return (
    <table className="rank-table shift-table">
      {/*
       * .rank-table is `table-layout: fixed`, so without this the four columns
       * split evenly and the identity column - the only one holding words -
       * gets exactly as much room as "%OA".
       *
       * The shares are measured, not estimated, and they are measured at the
       * two widths this panel is actually deployed at: the table is 398px inside
       * the deck's 1fr column at 1180 (iPad Air, the target) and 358px at 1080
       * (iPad 10.2"). Both fit on these numbers with nothing clipped and the
       * identity line unwrapped; 39.5/27.5 wraps the state at 1080 and 42/25
       * clips the output pair there, so there is about half a percent of slack
       * in either direction. Moving one means re-measuring the rest.
       *
       *   40%    the label and the state dot and its word on one line, with
       *          "1/2 · 08:00-20:00 · 12h" unwrapped under it. The floor is the
       *          Thai state word, "กำลังดำเนินการ" - the longest run in the
       *          table - sitting after the label's fixed track. See below.
       *   27%    "1,878 / 18,901" - a pair, and the widest value in the table.
       *   16.5%  %ACHV. The floor is the head in Thai, "%ตามแผน", not a value.
       *   16.5%  %OA. The floor is "100.0%", not the head.
       */}
      <colgroup>
        <col style={{ width: '40%' }} />
        <col style={{ width: '27%' }} />
        <col style={{ width: '16.5%' }} />
        <col style={{ width: '16.5%' }} />
      </colgroup>
      <thead>
        <tr>
          {/* "Shift", not 'filter.range' - "Range" is the time picker up in the
              toolbar, and this column is the shift itself. The hours under each
              label are a property of the shift, not a second control. */}
          <th scope="col">{t('table.shift')}</th>
          {/* Ranged right like every other figure column on the board: three
              shifts are read by scanning down, and that is what lines the
              decimals up. See the .num note in components.css. */}
          <th scope="col" className="num">
            {t('table.output')}
          </th>
          <th scope="col" className="num">
            {t('table.achv')}
          </th>
          <th scope="col" className="num">
            {t('table.oa')}
          </th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.shift_code}>
            <td>
              <span className="shift-id">
                <span className="shift-id__top">
                  <span className="shift-id__label">{r.shift_label}</span>
                  {r.state !== 'complete' ? (
                    /*
                     * The same vocabulary as the masthead's live badge: a dot in
                     * --status-good-mark for running, --status-nodata-mark for
                     * nothing yet, with the word beside it in --sub. Deliberately
                     * not a tinted pill - green as a *ground* on this board means
                     * "on target", and a shift that is 9.9% of the way through
                     * its plan must not wear it.
                     */
                    <span
                      className={`shift-id__state${
                        r.state === 'in_progress' ? ' shift-id__state--live' : ''
                      }`}
                    >
                      <span className="shift-id__dot" aria-hidden="true">
                        ●
                      </span>
                      {r.state === 'in_progress' ? t('shift.inProgress') : t('shift.notStarted')}
                    </span>
                  ) : null}
                </span>
                <span className="shift-id__hours">
                  {/*
                   * "1/2", not the scope head's "(1 of 2)", and on this line
                   * rather than beside the label.
                   *
                   * Both are width decisions, and the width they buy is what the
                   * line above spends on holding the state at a fixed offset -
                   * see .shift-id__label in components.css. Spelled out and
                   * beside the label, the three runs came to 153px of a column
                   * that is 143 at 1080.
                   *
                   * The reading is not lost: it is on the element as a title,
                   * and spelled out for a screen reader beside it - the same
                   * split .statuschip makes for the same reason.
                   */}
                  <span
                    className="shift-id__seq"
                    title={`${r.index} ${t('common.of')} ${r.of}`}
                    aria-hidden="true"
                  >
                    {r.index}/{r.of}
                  </span>
                  <span className="visually-hidden">
                    {r.index} {t('common.of')} {r.of}
                  </span>
                  {' · '}
                  {formatClock(r.start_local, timeZone, lang)}–
                  {formatClock(r.end_local, timeZone, lang)}
                  {' · '}
                  {/* floor, not round: a 12.5h shift used to print "13h30m",
                      an hour more than it runs, because the remainder was added
                      to a figure that had already absorbed it. */}
                  {Math.floor(r.duration_min / 60)}h
                  {r.duration_min % 60 ? ` ${r.duration_min % 60}m` : ''}
                </span>
              </span>
            </td>
            <td className="num">
              {r.qty_pcs === null
                ? dash
                : `${formatInt(r.qty_pcs, lang)} / ${formatInt(r.plan_qty ?? 0, lang)}`}
            </td>
            <td className="num">
              {r.achievement_pct === null ? dash : formatPct(r.achievement_pct, lang)}
            </td>
            <td className="num">{r.oa_pct === null ? dash : formatPct(r.oa_pct, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
