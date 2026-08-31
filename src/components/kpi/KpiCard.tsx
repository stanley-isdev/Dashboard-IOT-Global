import type { ReactNode } from 'react';
import type { Tier } from '../../api/contract';
import type { Measure } from '../../domain/measure';
import { TIER_TONE, type KpiTone } from '../../domain/tier';
import { useI18n } from '../../i18n/I18nProvider';
import { interpolateNodes } from '../../i18n/interpolate';
import { en, type TKey } from '../../i18n/en';
import { MeasureValue } from '../primitives/MeasureValue';
import { StatusIcon } from '../primitives/StatusIcon';

export interface Coverage {
  reporting: number;
  total: number;
}

/**
 * Renders one info-panel string, letting it be a list instead of a paragraph.
 *
 * A line beginning `- ` becomes a bullet; everything else stays prose. Two
 * reasons a string ever needs this, and both are the same reason: the %OA panel
 * has to say that two *different* kinds of machine are excluded for two
 * different reasons, and written as one sentence with separators it read as a
 * wall - the reader could not see there were two of anything. Shortening it did
 * not help, because length was never the problem; the structure was.
 *
 * Opt-in by construction. A string with no `- ` line renders exactly as it did
 * before, so the cards whose notes are genuinely one sentence are untouched.
 */
function SourceText({
  text,
  params = {},
}: {
  /** The raw dictionary template, still holding its `{name}` placeholders. */
  text: string;
  /** Node params, so a live figure inside any line renders as a pill. */
  params?: Record<string, ReactNode>;
}) {
  const line = (l: string) => interpolateNodes(l, params);
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.some((l) => l.startsWith('- ')))
    return <p className="kpi__source-body">{line(text)}</p>;

  // Runs of bullets and runs of prose, in the order written. Grouped rather than
  // split at the first bullet so a caveat can follow a list - the %OA panel
  // names what is excluded, then says what the figure leaves out, and those are
  // two different statements that must not merge into one.
  const blocks: { bullets: boolean; lines: string[] }[] = [];
  for (const raw of lines) {
    const bullets = raw.startsWith('- ');
    const last = blocks[blocks.length - 1];
    const content = bullets ? raw.slice(2).trim() : raw;
    if (last && last.bullets === bullets) last.lines.push(content);
    else blocks.push({ bullets, lines: [content] });
  }

  return (
    <>
      {blocks.map((block, i) =>
        block.bullets ? (
          <ul key={i} className="kpi__source-list">
            {block.lines.map((item, j) => (
              <li key={j}>{line(item)}</li>
            ))}
          </ul>
        ) : (
          block.lines.map((text, j) => (
            <p key={`${i}-${j}`} className="kpi__source-body">
              {line(text)}
            </p>
          ))
        ),
      )}
    </>
  );
}

export interface KpiCardProps {
  labelKey: TKey;
  measure: Measure;
  format?: (value: number) => string;
  /**
   * Colours the figure. Left neutral unless the caption directly under it names
   * the state the colour is standing for - see the comment in the component.
   */
  tone?: KpiTone;
  /** Resolved by the backend. Accepted as a shorthand for `tone` by the
   *  drill-down pages, which tier their cards from the payload. */
  tier?: Tier;
  /**
   * Required, deliberately. A KPI without a declared denominator is how six
   * disconnected sites end up quietly dragging a group average toward zero -
   * there is no way to write one here without saying what it was divided by.
   */
  coverage: Coverage;
  /** The one caption line under the rule. */
  footKey?: TKey;
  footParams?: Record<string, string | number>;
  /** Used in place of `footKey` when the caption has to be composed. */
  foot?: ReactNode;
  /** Colours the caption. Independent of `tone`: the artboard draws a black
   *  "65" over a green "6 of 9 Connected". */
  footTone?: KpiTone;
  /**
   * The qualifier, top right: the share, the target, the plan, the alert badge.
   * The redraw lifts it off the caption line, and that is what frees the caption
   * for the definition - see the note on what is *not* on the card below.
   */
  meta?: ReactNode;
  /** Colours `meta`. Independent of `tone` for the same reason `footTone` is. */
  metaTone?: KpiTone;
  /**
   * The distance to this card's own goal, set small beside the figure.
   *
   * Beside the figure and not on the qualifier line, which is where the goal
   * itself is stated: `.kpi__meta` is documented as the one thing on the card
   * that may not shrink, and the caption below it is already at the width where
   * an ellipsis eats the qty unit. The figure's row is the only place on the
   * card with room, and it is also where the gap belongs - a reader looking at
   * 83.4% is asking "against what" in the same glance.
   *
   * Always give it a unit. "-11.6" alone beside a percentage is ambiguous
   * between points and percent, and those are different numbers.
   */
  delta?: ReactNode;
  /** Colours `delta`. Defaults to neutral: a gap is not a status until
   *  something has tiered it, and only %OA has a served tier. */
  deltaTone?: KpiTone;
  /**
   * Colours the rail along the card's top edge. Defaults to the figure's tone,
   * which is right for five of the six cards. %OA is the exception and sets it
   * by hand: its figure is deliberately black - a number is not a status until
   * something compares it to a target - while the card as a whole is the thing
   * that target qualifies.
   */
  railTone?: KpiTone;
  /** Legacy alias for `footKey`, still used by the drill-down pages. */
  definitionKey?: TKey;
  definitionParams?: Record<string, string | number>;
  /**
   * Whether this card prints "Based on N of M sites" when coverage is partial.
   *
   * `auto` - the default - prints it. `off` is for a card that already states
   * the denominator in its own caption, and for its neighbours on a strip where
   * one card states it for all of them. See the note in the component.
   */
  coverageNote?: 'auto' | 'off';
  /**
   * Interpolated into the by-convention `{labelKey}.tooltip` string.
   *
   * A tooltip that has to name a threshold cannot be a constant: the threshold
   * is served (D-16), and a hardcoded "75%" in a help string is the same bug the
   * tier policy exists to prevent, one indirection further away from the code
   * that would contradict it.
   */
  tooltipParams?: Record<string, string | number>;
  /**
   * Provenance: where this card's figure came from, behind an ⓘ in the head.
   *
   * Separate from `{labelKey}.tooltip`, which says what the figure *means*.
   * This one answers the other question an executive asks of a number on a
   * wall - "who counted it" - and it has to be answerable without finding
   * someone in IS. The label's `title` cannot carry it: a `title` needs a
   * pointer hovering, and this board's other half lives on a touch panel.
   */
  infoKey?: TKey;
  /**
   * Live figures for the panel's `{name}` placeholders. Each is drawn as a
   * pill and re-keyed on its own value, so it replays the tick animation when
   * the number changes - the panel's whole "this is live" mechanism.
   *
   * Only put a figure here if it actually comes off the payload. See `infoFixed`.
   */
  infoParams?: Record<string, string | number>;
  /**
   * Values that fill placeholders but never tick: served thresholds, policy
   * numbers, anything from config. Rendered as plain text.
   *
   * Split from `infoParams` because the pill is a claim about freshness. A
   * threshold of 75 wearing the same pill as a live machine count says the two
   * are the same kind of number, and once a reader learns the marking is
   * meaningless they stop seeing it on the figures where it matters.
   */
  infoFixed?: Record<string, string | number>;
  /**
   * Widens this card's info panel.
   *
   * For a panel whose lead is a definition list rather than a sentence - %OA
   * names its three inputs before stating the formula, and at the default width
   * every one of those lines wrapped. Opt-in per card on purpose: the strip
   * reads best when its panels match each other, so this is for the one that
   * genuinely has more to say, not a default nobody revisits.
   */
  infoWide?: boolean;
}

/**
 * One card of the executive strip: a figure, its caption, a rule, one line of
 * context.
 *
 * ## On colouring the figure
 *
 * The artboard sets "54" in green and "11" in red, and that is safe *here*
 * specifically because the word is directly underneath: the label reads RUNNING
 * and STOP. src/domain/status.ts requires every status to carry a glyph or a
 * word alongside its colour, because red and amber sit at a deuteranope colour
 * distance of roughly 2-6 against a usable floor of 6-8 - and this audience
 * skews male and over forty. The layout satisfies that requirement, so no glyph
 * is added on top of it. A card whose caption does *not* name a state stays
 * neutral, which is why "65" and "82.9%" are black.
 *
 * ## On what is and is not on the card
 *
 * The card reads top to bottom: label, qualifier beside it, figure, one line of
 * definition. Splitting the label row in two is what bought that last line - the
 * target, the share and the plan used to sit on the caption, so the %OA card's
 * "excludes machine downtime" (D-19) had nowhere to go. It is on the card now.
 *
 * D-20's weighting method still is not: it is a sentence, not a line. It lives
 * in the methodology dialog, one tap from the map panel head, with the label
 * carrying the full text as its tooltip.
 */
export function KpiCard({
  labelKey,
  measure,
  format,
  tone,
  tier,
  coverage,
  footKey,
  footParams,
  foot,
  footTone = 'neutral',
  meta,
  metaTone = 'neutral',
  delta,
  deltaTone = 'neutral',
  railTone,
  definitionKey,
  definitionParams,
  coverageNote = 'auto',
  tooltipParams,
  infoKey,
  infoParams,
  infoFixed,
  infoWide = false,
}: KpiCardProps) {
  const { t, tNode } = useI18n();
  const partial = coverageNote === 'auto' && coverage.reporting < coverage.total;

  /*
   * Every value interpolated into a formula is a figure off the payload on
   * screen right now, so each is drawn as a pill rather than run into the
   * sentence - and re-keyed on its own value.
   *
   * That key is the entire "this is live" mechanism: when the number changes
   * React unmounts the old span and mounts a new one, which replays the CSS
   * tick. No timer, no previous-value state, and nothing to keep in sync with
   * the poll interval. When the figure holds steady the pill simply sits there,
   * which is also the truth.
   */
  const panelParams: Record<string, ReactNode> = {
    /*
     * Fixed values go in plain, before the live ones are laid over them.
     *
     * The pill is not decoration, it is a claim: this figure came off the
     * current payload and will tick when the next one lands. A served
     * threshold - 75, 90 - does not tick, so giving it the same treatment
     * teaches the reader that the marking means nothing.
     */
    ...(infoFixed ?? {}),
    ...Object.fromEntries(
      Object.entries(infoParams ?? {}).map(([name, value]) => [
        name,
        <span key={String(value)} className="kpi__source-live">
          {value}
        </span>,
      ]),
    ),
  };
  const valueTone = tone ?? (tier ? TIER_TONE[tier] : 'neutral');
  const rail = railTone ?? valueTone;

  const caption =
    foot ??
    (footKey ? t(footKey, footParams) : definitionKey ? t(definitionKey, definitionParams) : null);

  /*
   * `t` falls back to returning the key itself, so asking for a tooltip that
   * does not exist would set `title="kpi.machines.tooltip"` on five of the six
   * cards. Membership is checked against the English dictionary - which is the
   * schema every locale is typed against - rather than against the value.
   */
  const tooltipKey = `${labelKey}.tooltip`;
  const tooltip = tooltipKey in en ? t(tooltipKey as TKey, tooltipParams) : undefined;

  return (
    <div className={`kpi kpi--${valueTone} kpi--rail-${rail}`} data-tier={tier ?? 'neutral'}>
      {/*
       * Label first, figure second - the redraw's order, and the order a screen
       * reader wants anyway: "Running, 54" is a fact, while "54, Running" is a
       * number the listener has to hold until the label arrives.
       */}
      <div className="kpi__head">
        {/*
         * Label and its ⓘ travel together as one flex item, so the mark sits
         * against the end of the word rather than ranged right against the card
         * edge. Ranged right it reads as a second qualifier competing with
         * `kpi__meta`; against the label it reads as belonging to it.
         */}
        <div className="kpi__title">
          <div className="kpi__label" title={tooltip}>
            {t(labelKey)}
          </div>
          {infoKey == null ? null : (
            <>
              {/*
               * A native popover, not a positioned div. `.kpi` sets
               * `overflow: hidden` so a long label can ellipsis, and anything
               * absolutely positioned inside the card would be clipped by it.
               * The top layer is outside that box, and brings light-dismiss,
               * Escape, and - because the invoking button is the popover's
               * implicit anchor - CSS anchor positioning, all without a
               * document-level handler or a ref.
               *
               * The id is derived from `labelKey` rather than `useId`, because
               * `popovertarget` is resolved by getElementById and a readable,
               * stable id is easier to find in devtools than `«r3»`. Label keys
               * are unique per card, which is what makes it collision-free.
               */}
              <button
                type="button"
                className="kpi__info tap"
                popoverTarget={`${labelKey.replace(/\./g, '-')}-source`}
                aria-label={t('kpi.info.open', { label: t(labelKey) })}
                title={t('kpi.info.open', { label: t(labelKey) })}
              >
                {/*
                 * Drawn, not typed. `ⓘ` is a single character at the mercy of
                 * whichever fallback font owns U+24D8, and at 11px that lands
                 * as a smudge - the same reason StatusIcon.tsx exists at all,
                 * and its `info-circle` is the mark this set already uses for
                 * "here is an explanation".
                 */}
                <StatusIcon name="info-circle" />
              </button>
              <div
                id={`${labelKey.replace(/\./g, '-')}-source`}
                popover="auto"
                className={`kpi__source${infoWide ? ' kpi__source--wide' : ''}`}
              >
                <h3 className="kpi__source-title">{t(labelKey)}</h3>
                <SourceText text={t(infoKey)} params={panelParams} />
                {/*
                 * The rule that decides which machines count, boxed and set on
                 * its own line - it is the one part of this panel a reader
                 * comes back to check, and a formula buried mid-sentence is a
                 * formula nobody re-reads. Looked up beside the base key rather
                 * than passed as a prop, the same way `{labelKey}.tooltip` is,
                 * so a card whose figure needs no rule simply has no `.formula`
                 * string and this renders nothing.
                 */}
                {`${infoKey}.formula` in en ? (
                  <p className="kpi__source-formula mono">
                    {tNode(`${infoKey}.formula` as TKey, panelParams)}
                  </p>
                ) : null}
                {`${infoKey}.note` in en ? (
                  <SourceText text={t(`${infoKey}.note` as TKey)} params={panelParams} />
                ) : null}
              </div>
            </>
          )}
        </div>
        {meta == null ? null : <div className={`kpi__meta kpi__meta--${metaTone}`}>{meta}</div>}
      </div>

      <div className="kpi__value">
        <MeasureValue measure={measure} format={format} emphasis="kpi" />
        {delta == null ? null : (
          <span className={`kpi__delta kpi__delta--${deltaTone}`}>{delta}</span>
        )}
      </div>

      {/*
       * The coverage warning is the one thing allowed above the rule, and only
       * when coverage is genuinely partial. It is the difference between "88.9%
       * of the fleet is running" and "88.9% of the third of the fleet we can
       * see is running".
       *
       * On the overview strip it appears once rather than six times: all six
       * cards share one denominator, the leading card's caption *is* that
       * denominator ("3 of 9 connected", in amber), and six copies of the same
       * sentence is the kind of repetition a reader learns to stop seeing. The
       * drill-down grids keep the default, because nothing there states it.
       */}
      {partial ? (
        <div className="kpi__coverage">
          {t('coverage.partial', { reporting: coverage.reporting, total: coverage.total })}
        </div>
      ) : null}

      {caption === null ? null : (
        <div className={`kpi__foot kpi__foot--${footTone}`}>{caption}</div>
      )}
    </div>
  );
}
