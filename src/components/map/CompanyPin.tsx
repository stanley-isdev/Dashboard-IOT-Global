import { memo } from 'react';
import type { CompanySummary } from '../../api/contract';
import { absenceTooltip, quietCaption } from '../../domain/absence';
import { toMeasure } from '../../domain/measure';
import { isReporting, siteToken, tierToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatInt } from '../../i18n/format';
import { useSelection } from '../../state/selectionStore';
import { MeasureValue } from '../primitives/MeasureValue';

/**
 * One pin per company, not per plant.
 *
 * Section 3 of the design doc is explicit about this: several plants sit on the
 * same site, so plant-level pins would land on top of each other. The pin rolls
 * up to `codeCompany` and the plants appear on drill-down.
 *
 * The pin is three absolutely-positioned pieces sharing an origin at the site's
 * coordinate: a dot on the coordinate itself, a card offset away from it, and a
 * hairline leader joining the two. MapLabelLayer owns where the card goes and
 * how long the leader is - see the layout pass there. This component only says
 * what a pin contains.
 *
 * ## The card is a button, and used to be a link
 *
 * Tapping it opened `/company/{code}` directly. Now it selects the base, and
 * BaseDrawer - a full-height panel at the right-hand edge of the board - reads
 * the selection and shows it. The pin knows nothing about the drawer beyond
 * setting a code in the selection store; see the note there for why that is not
 * a prop threaded down from the page.
 *
 * Worth being explicit about what that costs: a base's own page is no longer
 * reachable from the map at all. That is deliberate for now - the page has
 * nothing on it yet - but it means the map is currently a read-only surface.
 *
 * A real `<button>` and not a div with a handler, for the same reason the card
 * was a real `<Link>` before it: it takes focus, and it fires on Enter and
 * Space. `aria-haspopup="dialog"` says what the tap opens; there is no
 * `aria-expanded`, because what opens is not inside this button and not beside
 * it - the drawer names the base in its own accessible name instead.
 *
 * ## Every base gets a card, including the six with no gateway
 *
 * They are drawn quieter - grey accent, `--panel-2` behind them, an italic
 * "not connected" where the others carry a percentage - but they are the same
 * object at the same size, because they are the same kind of thing: a Stanley
 * base, on the map, that someone may need to point at in a meeting. A base
 * reduced to a bare dot has to be hovered before it will say its own name, and
 * "which one is that grey dot" is not a question a board should ask.
 *
 * The third line is where they differ, and it has to differ. A quiet card has
 * no running count to show, and the obvious filler - repeating `map.notConnected`
 * under a MeasureValue that has already rendered "⊘ Not connected" - printed the
 * same sentence twice in a three-line card.
 *
 * It carried the readiness state instead - installing, planned - until that was
 * found to be the wrong source. `readiness` is master data's claim, so STJ,
 * which is `live` and has never sent a row, drew a blank card captioned
 * **"Live"**: config deciding what the reader sees and getting it wrong, the
 * same defect as the `no_data` status this change set out to fix. The line now
 * comes from `absence`, which is derived from what actually arrived - see
 * `domain/absence.ts`, where it is a pure function so a test can hold it there.
 */
/*
 * Memoised, because the layer above it re-renders on things a pin has no stake
 * in - a board tab, a banner, the expand toggle. `company` is a reference out of
 * the query payload and `registerCard` is a stable callback, so between polls
 * this compares equal and the nine cards are left alone. Selection is read from
 * the store per pin rather than passed down, which is what keeps that true when
 * one of them is tapped; see the note on the subscription below.
 */
export const CompanyPin = memo(function CompanyPin({
  company,
  registerCard,
}: {
  company: CompanySummary;
  /** Hands the card element to the layout pass. */
  registerCard: (code: string, el: HTMLElement | null) => void;
}) {
  const { t, lang } = useI18n();
  /*
   * Subscribed narrowly, so eight of the nine pins do not re-render when the
   * ninth is selected. `toggle` is stable and `selected === code` is a boolean,
   * so a pin only re-renders when its own selected-ness actually flips.
   */
  const selected = useSelection((s) => s.selected === company.code);
  const toggle = useSelection((s) => s.toggle);

  const reporting = isReporting(company.status);
  const tier = tierToken(company.kpi.oa_tier);
  const site = siteToken(company.status);
  const token = reporting ? tier : site;
  /* The same test the NEEDING ATTENTION card counts and the ranking tints its
     rows with, so the pulsing dots and the strip's figure can never disagree. */
  const alert = reporting && company.kpi.oa_tier === 'critical';

  /*
   * What a pin with no numbers says instead, and what hovering it explains.
   *
   * The server sends `absence` for any site that is genuinely unreachable, and
   * its presence alone is the signal - the caption states what the query
   * established, "no telemetry received", without needing anything from config.
   * The hover adds what config knows on top, where there is room for a
   * sentence: whether the claim in master data contradicts the data, and, for
   * the sites where a human knows more than the query, why and whose.
   */
  const caption = quietCaption(company.status, t);
  const absenceTitle = absenceTooltip(
    company.absence,
    { code: company.code, statusLabel: t(site.labelKey as TKey) },
    t,
  );

  return (
    /*
     * `data-quiet` carries the *kind* of silence down to the CSS, and is absent
     * on a base that is reporting.
     *
     * One attribute on the root rather than a modifier per piece, because all
     * three pieces answer to it: the dot, the leader and the card. Its two
     * values are the site statuses themselves - a base that has never sent a
     * row is drawn as a dashed, unelevated card, and one that is merely quiet
     * across the chosen window keeps a solid frame and takes the blue accent.
     * See the block under .pin__card in leaflet-overrides.css for the drawing
     * and src/domain/status.ts for why the two are not the same state.
     */
    <div
      className={`pin${selected ? ' pin--selected' : ''}`}
      data-quiet={reporting ? undefined : company.status}
      data-pin={company.code}
    >
      {/* Leader line. Width and rotation are written by the layout pass. */}
      <span className="pin__line" aria-hidden="true" />

      {/*
       * A radar ring, on the bases in the red tier and nowhere else.
       *
       * Motion is the one channel on this board that reaches a reader who is not
       * looking at it - which is most of the day, on a panel in a corridor. It is
       * spent on the single state that wants somebody to walk over: a site whose
       * %OA is below the critical threshold. Warn does not get one; nine amber
       * bases pulsing at each other would leave the board with no quiet state to
       * be read against, and the tier shape and colour already carry it.
       *
       * `alert` is the *tier*, not the site status, because a base that has gone
       * quiet has no current figure to be critical about - its last one may have
       * been, and pulsing over a stale number is asking for someone to be sent
       * out over a reading from yesterday.
       *
       * The global prefers-reduced-motion rule in base.css collapses the
       * animation to nothing, so this needs no guard of its own.
       */}
      {alert ? <span className="pin__pulse" aria-hidden="true" /> : null}

      {/* The coordinate itself. Shape as well as colour: a site that sends no
          telemetry gets a hollow, dashed, smaller dot, which survives greyscale
          and three metres of distance in a way a hue change does not. */}
      <span
        className={`pin__dot${reporting ? '' : ' pin__dot--quiet'}`}
        style={{ background: token.markVar, borderColor: token.markVar }}
        aria-hidden="true"
      />

      {/*
       * `data-tier` drives the card's left edge, which is the artboard's tier
       * accent. It is set from the *reporting* state first: a site with no
       * gateway has no tier, and colouring its card by `oa_tier: unknown` would
       * be indistinguishable from a site that reported an unknown figure.
       */}
      <button
        type="button"
        className="pin__card"
        data-tier={reporting ? company.kpi.oa_tier : 'none'}
        onClick={() => toggle(company.code)}
        aria-haspopup="dialog"
        ref={(el) => registerCard(company.code, el)}
        aria-label={t('map.pinLabel', {
          company: company.code,
          country: company.country_code,
          status: t(site.labelKey as TKey),
        })}
        /* An unreachable base explains itself on hover; every other base keeps
           the plain "open this" hint, because its numbers are already on the
           card and a tooltip repeating them is noise. */
        title={absenceTitle ?? t('drawer.open', { company: company.code })}
      >
        <span className="pin__oa">
          <MeasureValue
            measure={toMeasure(company.kpi.oa_pct, company.status, { asOf: company.last_seen })}
            tier={reporting ? company.kpi.oa_tier : undefined}
            emphasis="pin"
          />
        </span>

        <span className="pin__name">
          <span className="pin__cc">{company.country_code}</span>
          <span className="pin__code">{company.code}</span>
        </span>

        <span className="pin__meta">
          {reporting ? (
            <>
              {formatInt(company.counts.running, lang)}/{formatInt(company.counts.total, lang)}{' '}
              {t('bucket.running').toLowerCase()}
              {company.shift ? ` · ${company.shift.code}` : ''}
            </>
          ) : (
            /*
             * The observation, and there is no fallback to the rollout stage -
             * `readiness` no longer reaches this card at all.
             *
             * It used to print `readiness.{data_readiness}`, which captioned
             * STJ's figureless pin **"Live"**: master data calls it live and
             * always will, so a reader saw "connected, and blank". Keying on
             * `absence` fixed STJ but left `no_data` on the same broken path -
             * a company on a shutdown week is not `isReporting`, so it took
             * this branch with no absence to draw from and fell through to
             * "Live" again.
             *
             * `quietCaption` is exhaustive over the two non-reporting states,
             * so the `??` that used to sit here had nowhere left to go.
             */
            caption
          )}
        </span>
      </button>

    </div>
  );
});
