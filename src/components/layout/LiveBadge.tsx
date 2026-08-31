import type { ConnectionInfo } from '../../domain/connectionState';
import { useI18n } from '../../i18n/I18nProvider';
import { formatAgeShort } from '../../i18n/format';

/**
 * Freshness indicator - the left half of the status bar in the masthead.
 *
 * It draws no box of its own. The artboard joins it to the language switch as
 * one bordered pill, so `.statusbar` in TopBar owns the border, the radius and
 * the clipping, and this component contributes only its contents. Splitting it
 * that way keeps the freshness logic here and the language logic there, which
 * is where each belongs.
 *
 * The artboard draws a green bar, a dot, the word "Live", and "updated 3s ago".
 * In the mockup that counter was driven by a one-second interval - i.e. it
 * climbed whether or not any data ever arrived. Here the age is the real age of
 * `generated_at`, so it resets when a payload lands and keeps climbing when one
 * does not, which is the only version that can tell a live board from a hung one.
 *
 * Nothing pulses. This screen runs all day, and a perpetually animating element
 * is both a burn-in risk and, after the first hour, invisible to the people who
 * sit under it.
 *
 * State is carried three ways over: the bar's colour, a glyph, and the word.
 */
export function LiveBadge({ info }: { info: ConnectionInfo }) {
  const { t, lang } = useI18n();

  const { glyph, labelKey, variant } = (() => {
    switch (info.state) {
      case 'live':
        return { glyph: '●', labelKey: 'live.live' as const, variant: 'live' };
      case 'stale':
        return { glyph: '◷', labelKey: 'live.stale' as const, variant: 'stale' };
      case 'frozen':
        return { glyph: '◷', labelKey: 'live.stale' as const, variant: 'offline' };
      case 'cold_fail':
        return { glyph: '⊘', labelKey: 'live.offline' as const, variant: 'offline' };
      case 'cold':
        return { glyph: '◌', labelKey: 'live.slow' as const, variant: 'cold' };
    }
  })();

  return (
    <span className={`livebadge livebadge--${variant}`}>
      {/* The upright bar at the left edge, as drawn. Decoration that repeats
          what the glyph and the word already say, so it carries no meaning on
          its own - which is what lets it be a colour with no text beside it. */}
      <span className="livebadge__bar" aria-hidden="true" />
      <span className="livebadge__dot glyph" aria-hidden="true">
        {glyph}
      </span>
      <span className="livebadge__state">{t(labelKey)}</span>
      {info.ageSec !== null ? (
        <span className="livebadge__age">
          {t('live.age', { age: formatAgeShort(info.ageSec, lang) })}
        </span>
      ) : null}
    </span>
  );
}
