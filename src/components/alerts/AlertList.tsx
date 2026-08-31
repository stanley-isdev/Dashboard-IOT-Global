import type { Alert } from '../../api/contract';
import { severityToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatDuration } from '../../i18n/format';
import { StatusGlyph } from '../primitives/StatusGlyph';

/**
 * Longest active stops.
 *
 * Two changes from the mockup, both required rather than cosmetic.
 *
 * The severity dot is gone. It was a single red circle on every row regardless
 * of severity (T-10), which is colour-only encoding carrying no information at
 * all. Each row now shows a glyph, the severity word and the duration.
 *
 * The glyph and word ride in a tinted capsule rather than sitting loose in the
 * row. Five rows of bare text in five colours is a paragraph to be read; five
 * capsules is a column to be scanned, which is what a reader crossing a corridor
 * actually does with this panel. The capsule is a shape and a word first - the
 * tint only sorts what the reader has already been told.
 *
 * The hardcoded "Contact: Pi Surapoj" is gone too (T-08). Ownership is a role
 * and a team, never a person's name - this page is destined for a screen in a
 * factory corridor, and a named individual on it is a privacy problem that
 * nobody asked for.
 */
export function AlertList({ alerts }: { alerts: Alert[] }) {
  const { t } = useI18n();

  if (alerts.length === 0) {
    return <p style={{ color: 'var(--sub)', padding: 'var(--sp-4) 0' }}>{t('alerts.none')}</p>;
  }

  return (
    <div>
      {alerts.map((a) => {
        const token = severityToken(a.severity);
        const reasonKey = `alert.reason.${a.reason_code}` as TKey;
        const reason = t(reasonKey);
        return (
          <div className="alert-row" key={a.id}>
            <div className="alert-row__left">
              {/* The wrapper holds the column width so every reason starts at the
                  same x; the badge inside stays hugged to its own word, because a
                  capsule stretched to a grid column stops reading as a capsule. */}
              <div className="alert-row__sev">
                <span
                  className="sev-badge"
                  style={{
                    background: token.tintVar,
                    color: token.inkVar,
                    borderColor: token.markVar,
                  }}
                >
                  <StatusGlyph token={token} showLabel />
                </span>
              </div>
              <div style={{ minWidth: 0 }}>
                <div>
                  {a.machine ? `${a.machine} - ` : ''}
                  {/* Falls back to the server's own wording when a reason code
                      has no translation yet, so a new fault type is readable
                      the day it appears rather than the day it is translated. */}
                  {reason === reasonKey ? a.reason : reason}
                </div>
                <div className="alert-row__loc">
                  {a.company}
                  {a.plant ? ` · ${a.plant}` : ''}
                  {a.owner ? ` · ${t('alerts.owner', { role: a.owner.role })}` : ''}
                </div>
              </div>
            </div>
            <div className="alert-row__time" style={{ color: token.inkVar }}>
              {formatDuration(a.duration_sec)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
