import type { ShiftOutput } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { formatInt } from '../../i18n/format';

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
 */
export function HourlyOutputTable({ output }: { output: ShiftOutput }) {
  const { t, lang } = useI18n();
  const { buckets } = output;

  if (buckets.length === 0) return null;

  const dash = <span style={{ color: 'var(--status-nodata-ink)' }}>-</span>;
  const totalMin = buckets.reduce((a, b) => a + b.duration_min, 0);

  return (
    <div style={{ overflowX: 'auto' }}>
      <table className="rank-table" style={{ minWidth: `${buckets.length * 4.5}rem` }}>
        <caption className="visually-hidden">
          {output.shift_label} - {buckets.length} buckets
        </caption>
        <thead>
          <tr>
            <th scope="col" style={{ minWidth: '7rem' }}>
              {output.shift_label}
            </th>
            {buckets.map((b) => (
              <th
                key={b.index}
                scope="col"
                // Width tracks duration, so an unequal bucket is visibly
                // narrower rather than silently comparable.
                style={{
                  width: `${(b.duration_min / totalMin) * 100}%`,
                  background: b.is_partial ? 'var(--status-warn-tint)' : undefined,
                  textAlign: 'right',
                }}
              >
                <span className="mono" style={{ fontSize: 'var(--fs-nano)' }}>
                  {b.label.replace('-', '–')}
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
        </tbody>
      </table>
    </div>
  );
}
