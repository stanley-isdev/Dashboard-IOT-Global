import type { Absence, SiteStatus } from '../api/contract';
import type { TFunction } from '../i18n/I18nProvider';

/**
 * Turning the server's `absence` into the two strings a site with no numbers
 * needs: one line for a tile, and a sentence for a hover.
 *
 * Here rather than inline in CompanyPin because of the bug it exists to stop
 * coming back. That pin used to caption an empty tile with
 * `readiness.{data_readiness}`, so STJ - which master data calls `live` and
 * will keep calling `live` - rendered a blank card labelled **"Live"**. Config
 * decided what the reader saw, and got it wrong, exactly as it did for the
 * `no_data` status this whole change set out to fix. Pure functions can be
 * tested; a ternary buried in JSX had nothing holding it in place.
 */

/**
 * The one line that replaces a missing figure on a tile.
 *
 * **Driven by `status` - the observation - and never by `data_readiness`.** It
 * takes the status rather than the absence object because the two silences are
 * not the same and both have to be said correctly:
 *
 *   not_connected  nothing has ever arrived
 *   no_data        it HAS arrived before; there is none in this window
 *
 * Keying on the absence object alone was not enough, and the gap was live: a
 * `no_data` company - ASI's single plant going quiet, any site on a shutdown
 * week - is not `isReporting`, so the tile took this branch, while `absence` is
 * `null` for it because there is no absence to explain. The line came out empty
 * and fell back to `readiness.{...}`, which is exactly the "Live" caption on a
 * blank card that this function exists to prevent. Deriving from `status`
 * closes it: every non-reporting state has its own sentence, and config has no
 * route to the card at all.
 *
 * Does not consult `reason`: a site with an explanation and a site without one
 * are in the same state, and the explanation belongs in the hover where there
 * is room for it. `null` only for a reporting site, whose numbers the caller
 * should be showing instead.
 */
export function quietCaption(status: SiteStatus, t: TFunction): string | null {
  switch (status) {
    case 'not_connected':
      return t('absence.noDate');
    case 'no_data':
      return t('absence.quietWindow');
    default:
      // online / stale / degraded - it has a figure, and this line is not used.
      return null;
  }
}

/**
 * The full explanation, for a hover or any surface with room for a sentence.
 *
 * Ordered so the first line survives truncation: identity and status, then how
 * long, then - for the one case that is nobody's rollout stage and somebody's
 * open problem - that config and the data disagree, then the cause and its
 * owner. Newline-joined because its first consumer is a `title` attribute.
 */
export function absenceTooltip(
  absence: Absence | null,
  opts: { code: string; statusLabel: string },
  t: TFunction,
): string | null {
  if (!absence) return null;
  return [
    `${opts.code} · ${opts.statusLabel}`,
    t('absence.noDate'),
    absence.contradicts_config ? t('absence.contradiction') : null,
    // Both optional, and absent for most sites: only a human who knows more
    // than the query fills these in.
    absence.reason,
    absence.owner ? t('absence.owner', { owner: absence.owner }) : null,
  ]
    .filter((line): line is string => Boolean(line))
    .join('\n');
}
