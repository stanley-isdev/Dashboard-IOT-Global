import { useMatch } from 'react-router';
import { useMeta } from '../../api/queries';
import { useI18n } from '../../i18n/I18nProvider';
import type { Crumb } from './Breadcrumb';

/**
 * The trail for whatever page is mounted, read off the URL rather than
 * published upward by the page.
 *
 * The pages used to render this themselves, each building its own trail from
 * the payload it had just fetched. Read off the route instead, it is correct
 * on the first paint - before the fetch resolves - and there is no upward
 * channel to keep in sync, which is what the connection badge needs a context
 * for. Master data supplies the plant label; until it lands the crumb prints
 * the code alone, which is what the URL says anyway.
 *
 * ## Why it is its own file
 *
 * Two things in the masthead read it now. The breadcrumb draws the whole trail;
 * the Export button takes the last crumb and writes it into the PDF header, so
 * the board's name in the file is by construction the name the reader saw when
 * they pressed the button. Left in TopBar.tsx it was a second export from a
 * module of components, which costs that file its Fast Refresh - the lint rule
 * that says so is right, and a shared hook is exactly what it is asking for.
 */
export function useMastheadCrumbs(): Crumb[] {
  const { t } = useI18n();
  const meta = useMeta();
  const atCompany = useMatch('/company/:companyCode');
  const atPlant = useMatch('/company/:companyCode/plant/:plantCode');

  const root: Crumb = { label: t('nav.overview'), to: '/overview' };

  /* Two exact matches rather than one prefix match, so the company crumb
     cannot be built from a plant URL with a missing plant code. */
  if (atPlant) {
    const companyCode = atPlant.params.companyCode ?? '';
    const plantCode = atPlant.params.plantCode ?? '';
    const plant = meta.data?.companies
      .find((c) => c.code === companyCode)
      ?.plants.find((pl) => pl.code === plantCode);
    return [
      root,
      { label: companyCode, to: `/company/${companyCode}` },
      { label: plant ? `${plant.code} ${plant.label}` : plantCode },
    ];
  }

  if (atCompany) return [root, { label: atCompany.params.companyCode ?? '' }];

  return [];
}
