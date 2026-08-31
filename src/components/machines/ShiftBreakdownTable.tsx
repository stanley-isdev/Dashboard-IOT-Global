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
 * without a code change. Shifts that have not started show an em-dash rather
 * than a zero, and the one in progress is labelled - otherwise a shift showing
 * 45.9% achievement at 15:42 reads as a failure instead of as half-done.
 */
export function ShiftBreakdownTable({
  rows,
  timezone,
}: {
  rows: ShiftBreakdown[];
  timezone: string;
}) {
  const { t, lang } = useI18n();

  if (rows.length === 0) {
    return <p style={{ color: 'var(--sub)' }}>{t('shift.notConfigured')}</p>;
  }

  const dash = <span style={{ color: 'var(--status-nodata-ink)' }}>-</span>;

  return (
    <table className="rank-table">
      <thead>
        <tr>
          <th scope="col">{t('filter.range')}</th>
          <th scope="col">{t('table.output')}</th>
          <th scope="col">{t('table.achv')}</th>
          <th scope="col">{t('table.oa')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.shift_code}>
            <td>
              <span className="rank-table__name">
                <span>
                  {r.shift_label}{' '}
                  <span className="rank-table__sub">
                    ({r.index} {t('common.of')} {r.of})
                  </span>
                </span>
                <span className="rank-table__sub mono">
                  {formatClock(r.start_local, timezone, lang)}–
                  {formatClock(r.end_local, timezone, lang)} ·{' '}
                  {Math.round(r.duration_min / 60)}h
                  {r.duration_min % 60 ? `${r.duration_min % 60}m` : ''}
                </span>
                {r.state !== 'complete' ? (
                  <span className="rank-table__sub">
                    {r.state === 'in_progress' ? t('shift.inProgress') : t('shift.notStarted')}
                  </span>
                ) : null}
              </span>
            </td>
            <td className="mono">
              {r.qty_pcs === null ? dash : `${formatInt(r.qty_pcs, lang)} / ${formatInt(r.plan_qty ?? 0, lang)}`}
            </td>
            <td className="mono">
              {r.achievement_pct === null ? dash : formatPct(r.achievement_pct, lang)}
            </td>
            <td className="mono">{r.oa_pct === null ? dash : formatPct(r.oa_pct, lang)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
