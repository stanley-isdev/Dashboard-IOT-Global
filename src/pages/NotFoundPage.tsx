import { Link } from 'react-router';
import { useI18n } from '../i18n/I18nProvider';
import { useLinkWithFilters } from '../state/useFilters';

export function NotFoundPage() {
  const { t } = useI18n();
  const link = useLinkWithFilters();
  return (
    <div className="error-state">
      <div className="error-state__title">{t('error.notfound')}</div>
      <Link className="chip" to={link('/overview')}>
        {t('nav.overview')}
      </Link>
    </div>
  );
}
