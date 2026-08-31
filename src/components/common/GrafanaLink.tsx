import { useConfig } from '../../config/AppContext';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';

/**
 * Escape hatch into the existing Grafana dashboards.
 *
 * The URL is supplied by the backend so no dashboard UID is hardcoded here.
 * Section 10 notes that the current drill-down URL carries roughly forty query
 * parameters, including part names and plan quantities; that is a cache-busting
 * habit, not a contract. The backend sends keys and the destination queries for
 * the rest.
 *
 * Hidden in kiosk mode: a wall panel has no keyboard, and a second browser
 * window on it is a support call.
 */
export function GrafanaLink({
  url,
  /**
   * `icon` is the ranking's trailing arrow, as drawn - a 20px target in a 4%
   * column where the labelled chip would not fit. The label survives as the
   * accessible name, so the link is never an unlabelled glyph to a screen
   * reader.
   */
  variant = 'chip',
}: {
  url: string | null;
  variant?: 'chip' | 'icon';
}) {
  const { t } = useI18n();
  const cfg = useConfig();
  const kiosk = usePrefs((s) => s.kiosk);

  if (!url || kiosk) return null;

  const href = url.startsWith('http') ? url : `${cfg.grafanaBaseUrl}${url}`;
  const label = t('common.grafana');

  if (variant === 'icon') {
    return (
      <a className="rowlink" href={href} target="_blank" rel="noopener noreferrer" title={label}>
        <span className="glyph" aria-hidden="true">
          ↗
        </span>
        <span className="visually-hidden">{label}</span>
      </a>
    );
  }

  return (
    <a className="chip" href={href} target="_blank" rel="noopener noreferrer">
      <span className="glyph" aria-hidden="true">
        ↗
      </span>
      {label}
    </a>
  );
}
