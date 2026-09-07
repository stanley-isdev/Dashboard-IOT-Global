import type { ConnectionInfo } from '../../domain/connectionState';
import { useI18n } from '../../i18n/I18nProvider';
import { formatAgeShort } from '../../i18n/format';

/**
 * Freshness indicator - the left end of the status bar in the masthead.
 *
 * One capsule, divided by a hairline: the state on the left, the age on the
 * right. It was briefly two separate capsules, and that was wrong - the two
 * answer one question between them ("is this board live" is answered by "how old
 * is what I am reading"), so they belong inside one outline with a rule between
 * them rather than as two chips a reader has to work out are related.
 *
 * What the capsule lost is the coloured lozenge that used to sit inset in its
 * left edge. It was a third channel for the state on top of the glyph and the
 * word, and it had nowhere to sit once the dot owned that edge; the state is
 * still carried three ways - the dot's colour, the dot's *shape*, and the word -
 * which is what lets the colour do any work at all here.
 *
 * The artboard's counter was driven by a one-second interval - i.e. it climbed
 * whether or not any data ever arrived. Here the age is the real age of
 * `generated_at`, so it resets when a payload lands and keeps climbing when one
 * does not, which is the only version that can tell a live board from a hung one.
 *
 * Nothing pulses. This screen runs all day, and a perpetually animating element
 * is both a burn-in risk and, after the first hour, invisible to the people who
 * sit under it.
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
      <span className="livebadge__state">
        <span className="livebadge__dot glyph" aria-hidden="true">
          {glyph}
        </span>
        {t(labelKey)}
      </span>
      {info.ageSec !== null ? (
        <span className="livebadge__age">
          {t('live.age', { age: formatAgeShort(info.ageSec, lang) })}
        </span>
      ) : null}
    </span>
  );
}
