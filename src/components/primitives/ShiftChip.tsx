import type { Shift } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { formatClock, formatDate, zoneAbbrev } from '../../i18n/format';

/**
 * Shift identity, cardinality and local clock in one chip.
 *
 * "B Shift" on its own is meaningless across sites: STJ runs three shifts of
 * 8h, 8h15m and 7h45m while THS runs two of twelve hours. Without the
 * cardinality an executive will compare a THS shift total against an STJ shift
 * total and draw a conclusion from the difference in window length.
 *
 * The clock ticks locally between polls, because a frozen clock on a wall panel
 * reads as a broken screen. But it is guarded: if the ticking clock passes
 * `end_local` before the next payload arrives, the chip stops asserting the old
 * shift and says so. Without that guard STJ shows "B Shift" at 22:20.
 */
export function ShiftChip({
  shift,
  timezone,
  nowMs,
  variant = 'row',
}: {
  shift: Shift | null;
  timezone: string;
  nowMs: number;
  variant?: 'pin' | 'row' | 'header';
}) {
  const { t, lang } = useI18n();

  if (!shift) {
    // Never default to a two-shift assumption. When SEH's gateways come online
    // before its shift pattern is agreed, this is what must appear.
    return (
      <span className="shift-chip" title={t('shift.notConfigured.tooltip')}>
        <span className="glyph" aria-hidden="true">
          ◌
        </span>
        {t('shift.notConfigured')}
      </span>
    );
  }

  const nowIso = new Date(nowMs).toISOString();
  const clock = formatClock(nowIso, timezone, lang);
  const abbrev = zoneAbbrev(nowIso, timezone);
  const endMs = new Date(shift.end_local).getTime();
  const minsToEnd = (endMs - nowMs) / 60_000;

  const ended = minsToEnd <= 0;
  const endingSoon = !ended && minsToEnd <= 30;

  if (variant === 'header') {
    return (
      <span className="shift-chip">
        <span>
          {t('shift.header', {
            label: shift.label,
            start: formatClock(shift.start_local, timezone, lang),
            end: formatClock(shift.end_local, timezone, lang),
            time: `${clock} ${abbrev}`,
          })}
        </span>
        <span> · {t('shift.productionDate', { date: formatDate(shift.production_date, lang) })}</span>
      </span>
    );
  }

  const label =
    variant === 'pin'
      ? t('shift.chip', { code: shift.code, time: `${clock} ${abbrev}` })
      : t('shift.chipFull', {
          label: shift.label,
          index: shift.index,
          of: shift.of,
          time: `${clock} ${abbrev}`,
        });

  return (
    <span className={`shift-chip${ended || endingSoon ? ' shift-chip--ending' : ''}`}>
      {label}
      {ended ? <span> · {t('shift.ending')}</span> : null}
      {endingSoon ? (
        <span> · {t('shift.endsSoon', { time: formatClock(shift.end_local, timezone, lang) })}</span>
      ) : null}
      {variant === 'pin' ? (
        <span className="visually-hidden">
          {t('shift.chipFull', {
            label: shift.label,
            index: shift.index,
            of: shift.of,
            time: `${clock} ${abbrev}`,
          })}
        </span>
      ) : null}
    </span>
  );
}
