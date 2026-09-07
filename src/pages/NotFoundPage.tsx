import { Link, useLocation } from 'react-router';
import { StatePage } from '../components/feedback/StatePage';
import { useI18n } from '../i18n/I18nProvider';
import { useLinkWithFilters } from '../state/useFilters';

/**
 * The catch-all route: a URL that matches nothing in this app.
 *
 * Distinct from the `notfound` ApiError, which is a URL that *does* match a
 * route but names a site the server has never heard of. That one is handled by
 * HardErrorState, which has the code out of the payload to quote back. This one
 * only has the path, so the path is what it quotes.
 *
 * It renders StatePage like every other empty-board state rather than the bare
 * heading-and-chip it used to be, because a reader who lands here has taken a
 * wrong turn and the two things they need - what went wrong and the way back -
 * are exactly what that layout is for. Neutral, not critical: a stale
 * bookmark is not a fault in the system, and sending somebody to check a
 * database over one would waste their afternoon.
 */
export function NotFoundPage() {
  const { t } = useI18n();
  const link = useLinkWithFilters();
  const { pathname } = useLocation();

  return (
    <StatePage
      tone="neutral"
      glyph="map-pin"
      title={t('error.notfound')}
      /* The path, not a site code - this route never resolved one. */
      body={t('error.notfound.body', { code: pathname })}
      code={`ERR_ROUTE_NOT_FOUND · ${pathname}`}
      live="status"
      actions={
        <Link className="chip chip--action tap" to={link('/overview')}>
          {t('error.notfound.home')}
        </Link>
      }
    />
  );
}
