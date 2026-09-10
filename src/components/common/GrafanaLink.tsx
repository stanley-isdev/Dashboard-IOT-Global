import { OpenMark } from '../primitives/OpenMark';
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
 *
 * A `null` url is a site nobody has supplied a board for yet, not an error. The
 * icon variant still draws its arrow, dimmed and inert, because the alternative
 * - an empty cell on seven of nine rows - reads as a rendering fault, and a
 * reader who cannot see the affordance cannot tell "no board" from "the arrow
 * failed to load". The chip variant still renders nothing: a chip is a labelled
 * call to action with room to be missed, and a greyed one in a drawer is just
 * dead furniture.
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

  if (kiosk) return null;

  const label = t('common.grafana');

  if (!url) {
    if (variant !== 'icon') return null;
    const pending = t('common.grafanaPending');
    /*
     * A span, not a disabled anchor: there is no destination, so there is
     * nothing for a keyboard to open. It stays out of the tab order and out of
     * the accessibility tree - `title` alone would have screen readers announce
     * a control that does nothing - and the row's own name already says which
     * site this is. Sighted readers get the explanation on hover.
     */
    return (
      <span className="rowlink is-pending" aria-hidden="true" title={pending}>
        <OpenMark />
      </span>
    );
  }

  const href = url.startsWith('http') ? url : `${cfg.grafanaBaseUrl}${url}`;

  if (variant === 'icon') {
    return (
      <a className="rowlink" href={href} target="_blank" rel="noopener noreferrer" title={label}>
        <OpenMark />
        <span className="visually-hidden">{label}</span>
      </a>
    );
  }

  return (
    <a className="chip chip--link" href={href} target="_blank" rel="noopener noreferrer">
      <OpenMark />
      {label}
    </a>
  );
}
