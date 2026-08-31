import type { GlobalOverview, Tier } from '../../api/contract';
import { isRankable, tierToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatInt } from '../../i18n/format';
import { StatusIcon } from '../primitives/StatusIcon';

/** The tiers worth a word in a panel head, worst first. */
const ATTENTION: { tier: Tier; labelKey: TKey }[] = [
  { tier: 'critical', labelKey: 'tier.critical' },
  { tier: 'warn', labelKey: 'tier.warn' },
];

/**
 * The fleet in a handful of numbers, in the ranking's panel head.
 *
 * Two readings, drawn apart by a hairline because they answer two different
 * questions:
 *
 *   attention   how many reporting bases are below target, or critical
 *   coverage    how many of the nine are connected at all
 *
 * ## Why coverage is the half that has to add up
 *
 * Connected + offline is every base, always, so a reader can check the summary
 * against the rows underneath by counting - which is what makes a summary worth
 * trusting on a screen nobody can query. Without it the panel would say three
 * where the board says nine bases, and nothing on screen would say which of the
 * two was lying.
 *
 * That is also what lets the attention half be a *subset* readout rather than a
 * partition. It used to be one chip per tier - critical, below target, on
 * target, unknown - and the on-target chip was the whole reason the unknown one
 * had to exist: with "6 On target" on screen, a reporting base with no tier had
 * to be named or it was being quietly counted as fine. No chip claims "fine"
 * any more, so there is nothing left for an untiered base to be mistaken for,
 * and its %OA cell two rows down already reads as no-data.
 *
 * Three consequences of the same principle:
 *
 *   - The buckets are the tier the *row* was tinted by, not a fresh comparison
 *     against the target. `oa_tier` comes from the payload and the policy block
 *     behind it (D-20), so the head cannot disagree with the row it counts.
 *   - Zero counts are not drawn. "0 Critical" is a good fact and a bad chip -
 *     at a glance it is indistinguishable from "1 Critical", which is the single
 *     most expensive misreading on this panel. Its absence is the news.
 *   - Only reporting bases can be below target. A base with no gateway is
 *     counted once, in coverage, and never as a performance failure.
 *
 * Colour is never the encoding: each tier carries its own glyph - the octagon
 * and the exclamation triangle, told apart by outline rather than hue, per
 * src/domain/status.ts - and the map legend on the other half of this same
 * board is where a reader has already met that vocabulary.
 */
export function StatusSummary({ data }: { data: GlobalOverview | undefined }) {
  const { t, lang } = useI18n();

  // Nothing while the first payload is in flight. A row of zeroes under a
  // skeleton table would be wrong facts rather than none.
  if (!data) return null;

  const reporting = data.companies.filter((c) => isRankable(c.status));
  const connected = reporting.length;
  const offline = data.companies.length - connected;

  const chips = ATTENTION.map(({ tier, labelKey }) => ({
    tier,
    token: tierToken(tier),
    count: reporting.filter((c) => c.kpi.oa_tier === tier).length,
    label: t(labelKey),
  })).filter((c) => c.count > 0);

  return (
    <div className="statuschips" role="group" aria-label={t('summary.label')}>
      {chips.map((c) => {
        const sentence = t('summary.chip', {
          count: formatInt(c.count, lang),
          status: c.label,
        });
        return (
          /*
           * One chip, one sentence. Every visible part is aria-hidden and the
           * whole reading is carried by a single visually-hidden phrase, so what
           * assistive technology gets is "1 Below target" rather than
           * "▲ 1 Below target" - and it stays correct whatever the stylesheet
           * hides at which density.
           */
          <span key={c.tier} className="statuschip" style={{ color: c.token.inkVar }} title={sentence}>
            <span className="statuschip__glyph">
              <StatusIcon name={c.token.icon} />
            </span>
            <span className="statuschip__count" aria-hidden="true">
              {formatInt(c.count, lang)}
            </span>
            <span className="statuschip__word" aria-hidden="true">
              {c.label}
            </span>
            <span className="visually-hidden">{sentence}</span>
          </span>
        );
      })}

      {/*
       * The coverage half. Muted rather than tinted, and never dropped at any
       * density: "2 · 7" without its two words is a pair of numbers with no
       * subject, which is worse than a row that is a few pixels wide.
       */}
      <span className="statuschips__cover">
        <span aria-hidden="true">
          <b className="statuschip__count">{formatInt(connected, lang)}</b> {t('summary.connected')}
        </span>
        <span className="statuschips__mid" aria-hidden="true">
          ·
        </span>
        <span aria-hidden="true">
          <b className="statuschip__count">{formatInt(offline, lang)}</b> {t('summary.offline')}
        </span>
        <span className="visually-hidden">
          {t('summary.coverage', {
            connected: formatInt(connected, lang),
            offline: formatInt(offline, lang),
          })}
        </span>
      </span>
    </div>
  );
}
