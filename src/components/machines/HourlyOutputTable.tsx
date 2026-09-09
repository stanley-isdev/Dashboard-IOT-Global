import type { ShiftOutput } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { formatClock, formatInt, formatPct } from '../../i18n/format';

/**
 * Output per bucket across the current shift.
 *
 * This is the component the whole shift model exists to make possible, and the
 * one the old dashboard gets wrong in two separate ways (section 9.5). It
 * hardcodes twelve columns of `08:00 - 09:00`, which is wrong for STJ because
 * its A shift has eight, and wrong again because its B shift ends at 22:15 so
 * the final column covers fifteen minutes rather than sixty.
 *
 * Two rules follow, and the second matters more than it looks:
 *
 *   1. The column count is `buckets.length`. Never a constant.
 *   2. Column width is proportional to `duration_min`.
 *
 * Without rule 2 the 22:00-22:15 bucket is drawn the same width as a full hour,
 * so a quarter of an hour's output reads as a catastrophic collapse in the last
 * hour of B shift. Every night. The `qty_per_hour` row is the honest
 * cross-bucket comparison and is computed server-side.
 *
 * The column heads are formatted HERE, from each bucket's `start_utc`/`end_utc`,
 * and that is a third rule with a bug behind it. They used to be a `label`
 * string the backend baked in the site's own zone, which meant they were the one
 * clock on the board the display-zone picker could not reach: with Tokyo picked,
 * a reader saw the ShiftChip above this table say `Day 10:00-22:00` and the
 * table's first column say `08:00-09:00` - the same shift, two hours apart, on
 * one screen. A pre-formatted timestamp in a payload cannot be re-zoned by the
 * client that receives it, so the field is gone rather than merely unused.
 *
 * The bucket BOUNDARIES do not move: they are still cut on `start_utc`, still
 * the site's own shift, and every figure under them is the figure it was. Only
 * the clock the heads are read on changes, which is exactly what the time
 * panel's footer promises.
 */
export function HourlyOutputTable({
  output,
  timeZone,
}: {
  output: ShiftOutput;
  /** The clock to print the heads on, resolved by the caller through
      `useDisplayZone` - never the site's zone directly. */
  timeZone: string;
}) {
  const { t, lang } = useI18n();
  const { buckets } = output;

  if (buckets.length === 0) return null;

  const dash = <span style={{ color: 'var(--status-nodata-ink)' }}>-</span>;
  const totalMin = buckets.reduce((a, b) => a + b.duration_min, 0);

  /*
   * The label column's width, reserved out of the table before the hours share
   * what is left.
   *
   * The hour columns each declare a percentage of their duration, and those
   * percentages sum to 100 - so they claimed the whole table and the label
   * column was left with whatever the browser could squeeze it into. At
   * `table-layout: auto` that means its minimum content width, which broke
   * "Output (Pcs)" over two lines and "Pcs / hr" over three; told not to wrap
   * (see `.hourly th[scope='row']`), the same squeeze made the labels overlap
   * the first hour's figures instead. Neither is a width problem the stylesheet
   * can solve, because the number that is wrong is in the percentages.
   *
   * So the hours divide `100% - LABEL_W` rather than 100%, and the label column
   * asks for exactly LABEL_W. Wide enough for the longest label in either
   * locale - Thai's "ผลผลิต (Shot)" is the one that sets it.
   */
  const LABEL_W = '7.5rem';

  return (
    <div className="hourly">
      <table
        className="rank-table"
        /* The floor the hour columns need before the container starts
           scrolling, plus the label column that is no longer part of their
           share. */
        style={{ minWidth: `calc(${buckets.length * 4.5}rem + ${LABEL_W})` }}
      >
        <caption className="visually-hidden">
          {output.shift_label} - {buckets.length} buckets
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ width: LABEL_W }}>
              {output.shift_label}
            </th>
            {buckets.map((b) => (
              <th
                key={b.index}
                scope="col"
                // Width tracks duration, so an unequal bucket is visibly
                // narrower rather than silently comparable.
                style={{
                  width: `calc((100% - ${LABEL_W}) * ${b.duration_min / totalMin})`,
                  background: b.is_partial ? 'var(--status-warn-tint)' : undefined,
                  textAlign: 'right',
                }}
              >
                <span className="mono" style={{ fontSize: 'var(--fs-nano)' }}>
                  {formatClock(b.start_utc, timeZone, lang)}–
                  {formatClock(b.end_utc, timeZone, lang)}
                </span>
                {b.is_partial ? (
                  <span
                    className="mono"
                    style={{
                      display: 'block',
                      color: 'var(--status-warn-ink)',
                      fontSize: 'var(--fs-nano)',
                    }}
                  >
                    {b.duration_min}m
                  </span>
                ) : null}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {/* Section 8.5: pieces and shots are different facts and get their
              own rows, with the unit in the row header. They are swapped often
              enough that inferring the unit from context is not acceptable. */}
          <tr>
            <th scope="row">{t('table.output')} (Pcs)</th>
            {buckets.map((b) => (
              <td key={b.index} className="mono" style={{ textAlign: 'right' }}>
                {b.qty_pcs === null ? dash : formatInt(b.qty_pcs, lang)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">{t('table.output')} (Shot)</th>
            {buckets.map((b) => (
              <td key={b.index} className="mono" style={{ textAlign: 'right' }}>
                {b.qty_shots === null ? dash : formatInt(b.qty_shots, lang)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Pcs / hr</th>
            {buckets.map((b) => (
              <td
                key={b.index}
                className="mono"
                style={{ textAlign: 'right', color: 'var(--sub)' }}
              >
                {b.qty_per_hour === null ? dash : formatInt(b.qty_per_hour, lang)}
              </td>
            ))}
          </tr>
          {/*
           * %OA per bucket, and the row this table was missing.
           *
           * The three rows above are quantities, and the backend's hourly query
           * selects none of them - it selects %OA and nothing else (see the
           * header of server/src/services/scopeService.ts). So against a real
           * database this panel drew twelve columns of dashes while the one
           * figure it did have went unprinted. The efficiency of each hour of a
           * shift is exactly what this table is read for, so it belongs here
           * whether or not the quantities ever arrive.
           *
           * Its own row rather than a replacement for one: pieces, shots and
           * %OA are three different facts, which is the same reason section 8.5
           * gives for keeping pieces and shots apart.
           */}
          <tr>
            <th scope="row">{t('kpi.oa.short')}</th>
            {buckets.map((b) => (
              <td key={b.index} className="mono" style={{ textAlign: 'right' }}>
                {b.oa_pct === null ? dash : formatPct(b.oa_pct, lang)}
              </td>
            ))}
          </tr>
        </tbody>
      </table>
    </div>
  );
}
