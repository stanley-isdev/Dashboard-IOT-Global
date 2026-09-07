import { memo } from 'react';
import type { Alert } from '../../api/contract';
import { severityToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatDuration } from '../../i18n/format';
import { StatusGlyph } from '../primitives/StatusGlyph';
import { StatusIcon } from '../primitives/StatusIcon';

/**
 * Longest active stops.
 *
 * Three changes from the mockup, the first two required rather than cosmetic.
 *
 * The severity dot is gone. It was a single red circle on every row regardless
 * of severity (T-10), which is colour-only encoding carrying no information at
 * all. Each row now shows a glyph, the severity word and the duration.
 *
 * The hardcoded "Contact: Pi Surapoj" is gone too (T-08). Ownership is a role
 * and a team, never a person's name - this page is destined for a screen in a
 * factory corridor, and a named individual on it is a privacy problem that
 * nobody asked for.
 *
 * The row is then laid out as identity-first: a round severity mark, the machine
 * with its severity word pilled beside it, and everything that is context - the
 * reason, the site, the owning role - dropped to a quiet second line. Five rows
 * of equal-weight text is a paragraph to be read; a column of marks over a
 * column of names is a shape to be scanned, which is what a reader crossing a
 * corridor actually does with this panel.
 *
 * The mark is drawn bare, in the severity's own ink. It used to sit on a
 * neutral grey disc, which was never a good look in a panel whose rows are
 * nearly always the same severity - ten identical circles down the left edge
 * frame the marks rather than separating them. It is ink and not a solid
 * `mark` fill for the reason the disc was grey in the first place: a filled
 * badge is only held to 3:1 as a non-text graphic, and white on the amber that
 * `major`/`minor` resolve to measures 2.07:1 in the dark theme. As text-weight
 * ink the mark keeps the 4.5:1 check-contrast measures it at.
 */
/*
 * Memoised for the same reason as the chart beside it: the analytics board stays
 * mounted behind the fleet board, so without this up to fifty rows were rebuilt
 * on every tick of the page's clock while hidden. `alerts` is the memoised Top-N
 * slice from the page, so the list re-renders when the cut or the payload moves.
 */
export const AlertList = memo(function AlertList({ alerts }: { alerts: Alert[] }) {
  const { t } = useI18n();

  if (alerts.length === 0) {
    return <p className="alert-empty">{t('alerts.none')}</p>;
  }

  return (
    <div>
      {alerts.map((a) => {
        const token = severityToken(a.severity);
        const reasonKey = `alert.reason.${a.reason_code}` as TKey;
        const translated = t(reasonKey);
        // Falls back to the server's own wording when a reason code has no
        // translation yet, so a new fault type is readable the day it appears
        // rather than the day it is translated.
        const reason = translated === reasonKey ? a.reason : translated;
        const detail = [
          reason,
          a.company,
          a.plant,
          a.owner ? t('alerts.owner', { role: a.owner.role }) : null,
        ]
          .filter(Boolean)
          .join(' · ');

        return (
          <div className="alert-row" key={a.id}>
            {/* The shape, on its own. The word for it sits in the pill two
                elements along, so the icon here is decoration for a screen
                reader and StatusIcon is already aria-hidden. */}
            <span className="alert-row__mark" style={{ color: token.inkVar }}>
              <StatusIcon name={token.icon} size="1.15em" />
            </span>

            <div className="alert-row__body">
              <div className="alert-row__head">
                {a.machine ? <span className="alert-row__machine">{a.machine}</span> : null}
                {/* `showGlyph={false}` is safe here only because the mark above
                    is the same token: the pill is a word beside a shape, not a
                    word resting on a hue. */}
                <span
                  className="sev-badge"
                  style={{ background: token.tintVar, color: token.inkVar }}
                >
                  <StatusGlyph token={token} showLabel showGlyph={false} />
                </span>
              </div>
              <div className="alert-row__loc">{detail}</div>
            </div>

            <div className="alert-row__time" style={{ color: token.inkVar }}>
              {formatDuration(a.duration_sec)}
            </div>
          </div>
        );
      })}
    </div>
  );
});
