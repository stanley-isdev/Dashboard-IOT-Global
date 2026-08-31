import { isApiError } from '../../api/ApiError';
import { useT } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';

/**
 * Shown only when nothing has ever loaded and the request is failing.
 *
 * This is the one state where no numbers appear at all. Everywhere else the
 * last good payload stays visible under a banner; here there is no last good
 * payload, and inventing one would be the exact failure section 14 forbids.
 */
export function HardErrorState({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  const t = useT();

  const key: TKey = isApiError(error) ? (error.messageKey as TKey) : 'error.network';
  const detail = isApiError(error) ? error.detail : (error as Error | undefined)?.message;

  return (
    <div className="error-state" role="alert">
      <span className="glyph" style={{ color: 'var(--status-crit-ink)', fontSize: '1.5rem' }} aria-hidden="true">
        ■
      </span>
      <div className="error-state__title">{t('error.title')}</div>
      <p>{t(key)}</p>
      {detail ? (
        <details>
          <summary>{t('error.detail')}</summary>
          <pre className="error-state__detail">{detail}</pre>
        </details>
      ) : null}
      <button type="button" className="banner__action" onClick={onRetry}>
        {t('banner.retry')}
      </button>
    </div>
  );
}

/**
 * Loading placeholder. Deliberately never renders a zero.
 *
 * Same order as a real card - label, figure, caption - so the strip does not
 * visibly reflow when the first payload lands.
 */
export function SkeletonKpi() {
  return (
    <div className="kpi" aria-hidden="true">
      <div className="kpi__head">
        <div className="kpi__label skeleton" style={{ width: '60%' }}>
          &nbsp;
        </div>
      </div>
      <div className="kpi__value skeleton" style={{ width: '45%' }}>
        &nbsp;
      </div>
      <div className="kpi__foot">
        <span className="skeleton" style={{ display: 'inline-block', width: '75%' }}>
          &nbsp;
        </span>
      </div>
    </div>
  );
}
