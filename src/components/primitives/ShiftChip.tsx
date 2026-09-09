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
 * `timeZone` is the clock to PRINT on, resolved by the caller through
 * `useDisplayZone`, and not necessarily the site's own: in HQ mode this chip
 * reads "B Shift (2 of 3) - 09:00 ICT" for a base in Tokyo. What it must never
 * do is change WHICH shift it names or when that shift ends. Both come off the
 * payload already cut on the site's own shift, `production_date` is a plain
 * date with no zone to move, and `minsToEnd` below is instant arithmetic - so
 * the guard fires at the same moment in both modes.
 *
 * The clock ticks locally between polls, because a frozen clock on a wall panel
 * reads as a broken screen. But it is guarded: if the ticking clock passes
 * `end_local` before the next payload arrives, the chip stops asserting the old
 * shift and says so. Without that guard STJ shows "B Shift" at 22:20.
 */
export function ShiftChip({
  shift,
  timeZone,
  nowMs,
  variant = 'row',
}: {
  shift: Shift | null;
  timeZone: string;
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
  const clock = formatClock(nowIso, timeZone, lang);
  const abbrev = zoneAbbrev(nowIso, timeZone);
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
            start: formatClock(shift.start_local, timeZone, lang),
            end: formatClock(shift.end_local, timeZone, lang),
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
        <span> · {t('shift.endsSoon', { time: formatClock(shift.end_local, timeZone, lang) })}</span>
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
