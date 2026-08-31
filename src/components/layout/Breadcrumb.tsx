import { Link } from 'react-router';
import { useI18n } from '../../i18n/I18nProvider';
import { useLinkWithFilters } from '../../state/useFilters';

export interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumb({ trail }: { trail: Crumb[] }) {
  const { t } = useI18n();
  const link = useLinkWithFilters();

  return (
    <nav className="breadcrumb" aria-label={t('nav.overview')}>
      <ol>
        {trail.map((crumb, i) => (
          <li key={`${crumb.label}-${i}`}>
            {crumb.to ? <Link to={link(crumb.to)}>{crumb.label}</Link> : <span>{crumb.label}</span>}
            {i < trail.length - 1 ? <span aria-hidden="true">›</span> : null}
          </li>
        ))}
      </ol>
    </nav>
  );
}
