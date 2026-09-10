import type { Tier } from '../../api/contract';
import { hasValue, type Measure } from '../../domain/measure';
import { measureToken, tierToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatAge, formatPct } from '../../i18n/format';
import { StatusGlyph } from './StatusGlyph';

/**
 * The only way to put a Measure on screen.
 *
 * Because it takes a `Measure` and not a `number | null`, there is no call site
 * that can accidentally print a fabricated zero, and no call site that can call
 * `.toFixed()` on an absent value. The five arms of the union are handled here,
 * once.
 *
 * Every "no value" arm renders an em-dash plus a glyph plus a word - never a
 * blank cell, which reads as "we forgot", and never a zero, which reads as
 * "the line produced nothing".
 */

export interface MeasureValueProps {
  measure: Measure;
  /** How to render the number when there is one. Defaults to a percentage. */
  format?: (value: number) => string;
  /** Resolved by the backend. Drives the glyph and the ink colour. */
  tier?: Tier;
  emphasis?: 'kpi' | 'cell' | 'pin' | 'inline';
  /** Show the tier word next to the value. Off in tight cells. */
  showTierLabel?: boolean;
  /**
   * Draw the tier's shape before the value. On everywhere except the ranking's
   * %OA column, which the client asked to read as a bare tinted figure - see the
   * note on StatusGlyph for what that costs. The tier word still reaches
   * assistive technology either way.
   */
  showTierGlyph?: boolean;
}

export function MeasureValue({
  measure,
  format,
  tier,
  emphasis = 'cell',
  showTierLabel = false,
  showTierGlyph = true,
}: MeasureValueProps) {
  const { lang, t } = useI18n();
  const fmt = format ?? ((v: number) => formatPct(v, lang));

  if (hasValue(measure)) {
    const token = tier ? tierToken(tier) : null;
    // Only the stale arm carries an asOf, so the caption is built inside that
    // narrowing rather than beside it.
    const lastSeen =
      measure.kind === 'stale'
        ? t('site.lastSeen', { time: formatAge(ageOf(measure.asOf), lang) })
        : null;
    return (
      <span className={emphasis === 'kpi' ? '' : 'pct'} style={token ? { color: token.inkVar } : undefined}>
        {token ? (
          <StatusGlyph token={token} showLabel={showTierLabel} showGlyph={showTierGlyph} />
        ) : null}
        <span>{fmt(measure.value)}</span>
        {/*
         * A stale value says so. How it says so depends on the room it has.
         *
         * In a table cell the words do not fit and `white-space: nowrap` does not
         * make them fit - it makes them overprint. In the ranking's 62px %OA
         * column "83.3% as of 8 minutes ago" ran straight across %ACHV and
         * Downtime and left all three unreadable, which is worse than either the
         * number or the caveat alone. The scenario that does it is site-offline,
         * the one that exists to prove T-11.
         *
         * The KPI card's figure row has the same problem in miniature: the
         * caveat sits beside the target/plan pill in a column barely wider than
         * the pill itself, so "as of 5 minutes ago" wrapped onto its own line and
         * pushed the card taller than its neighbours. So the KPI card gets the
         * same clock-and-tooltip treatment as the cell; only the map pin, which
         * has a whole line to itself and nothing competing for it, keeps the
         * words visible.
         */}
        {measure.kind === 'stale' ? (
          emphasis === 'cell' || emphasis === 'kpi' ? (
            <span className="last-seen" title={lastSeen ?? undefined}>
              <StatusGlyph token={measureToken('stale')} />
              <span className="visually-hidden">{lastSeen}</span>
            </span>
          ) : (
            <span className="last-seen">
              {' '}
              {lastSeen}
            </span>
          )
        ) : null}
      </span>
    );
  }

  const token = measureToken(measure.kind);
  const label =
    measure.kind === 'not_applicable'
      ? t(measure.reasonKey as TKey)
      : t(token.labelKey as TKey);

  /*
   * `measure--absent` is what lets the hero slots set this arm at their own
   * size. "No data" and "No plan" are words, not readings, and at the KPI
   * card's 28px they were the loudest thing on a card that has nothing to
   * report - see the rule in components.css.
   */
  return (
    <span
      className="pct measure--absent"
      style={{ color: token.inkVar, fontStyle: 'italic', fontWeight: 500 }}
    >
      <StatusGlyph token={token} />
      {emphasis === 'pin' || emphasis === 'kpi' ? <span>{label}</span> : null}
      {emphasis === 'cell' || emphasis === 'inline' ? (
        <span className="visually-hidden">{label}</span>
      ) : null}
    </span>
  );
}

function ageOf(iso: string): number {
  return (Date.now() - new Date(iso).getTime()) / 1000;
}
