import { memo } from 'react';
import type { GlobalOverview, MachineStatus } from '../../api/contract';
import { toMeasure } from '../../domain/measure';
import { isRankable } from '../../domain/status';
import { TIER_TONE } from '../../domain/tier';
import { useI18n } from '../../i18n/I18nProvider';
import type { TKey } from '../../i18n/en';
import { formatInt, formatPct, formatSigned } from '../../i18n/format';
import { SkeletonKpi } from '../feedback/HardErrorState';
import { KpiCard, type Coverage } from './KpiCard';

/**
 * The two statuses RUNNING is made of, and therefore the two STOP is not.
 *
 * Spelled out here rather than imported from the server's `BUCKET_OF`: that
 * mapping has five buckets and this card has two sides, so borrowing it would
 * tie the strip's arithmetic to a classification it does not use. The pair is
 * also the one part of the status enum that is settled - D-21 is still open for
 * `4M Change`, and `Alarm` / `Warning` / `Pending` have never been reviewed -
 * so anything that is not one of these two is, for this card, not running.
 */
const RUNNING_STATUSES = new Set<MachineStatus>(['Mass Pro', 'Dandori']);

/**
 * The six-card executive strip, in the redraw's order:
 *
 *   Total machine · Running · Stop · Avg %OA · %Achievement · Needing attention
 *
 * Every card is the same three facts in the same three places: what it counts
 * (the label, with a subject mark against it), what qualifies it (the meta, top
 * right - a share, a target, a plan, an alert), and what it excludes (the foot).
 * Reading across the strip therefore compares like with like, which is the
 * reason the qualifier was lifted off the caption line in the first place.
 *
 * All six take `mark`, and therefore all six take `.kpi--feature`. That style
 * was drawn for the lead pair alone and was widened to the row by the design
 * owner; what it costs the strip is recorded against the class itself in
 * components.css, and `mark` is the single line per card that turns it on.
 *
 * Every card also divides by the reporting set, and the first card's caption -
 * "6 of 9 connected" - says so for the whole strip. It is the line that stops a
 * reader treating 65 machines as the group's machine count rather than its
 * *measurable* machine count, with three of nine bases still un-commissioned.
 * That card is the one with no meta, which is what leaves room for it.
 */
/*
 * Memoised on the payload. The page above ticks once a second so its clock
 * columns stay honest, and without this the whole strip - six cards, each with
 * its own arithmetic over the machine census - was rebuilt on every one of them
 * to print figures that only change when a poll lands. `data` is the query's own
 * reference, so that is exactly when this re-renders.
 */
export const KpiStrip = memo(function KpiStrip({ data }: { data: GlobalOverview | undefined }) {
  const { t, lang } = useI18n();

  if (!data) {
    return (
      <div className="kpis">
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonKpi key={i} />
        ))}
      </div>
    );
  }

  const { totals } = data;
  const coverage: Coverage = {
    reporting: totals.companies_reporting,
    total: totals.companies_total,
  };
  // Totals are already restricted to reporting sites by the backend, so the
  // status here is simply "these numbers exist".
  const online = 'online' as const;
  const int = (v: number) => formatInt(v, lang);
  const pct = (v: number) => formatPct(v, lang);

  const machines = totals.counts.total;
  const share = (n: number) => (machines > 0 ? (n / machines) * 100 : null);
  const runningShare = share(totals.counts.running);
  const attention = totals.companies_needing_attention;

  /*
   * STOP on this strip is **everything counted that is not running**, not the
   * `Stop` status alone.
   *
   * Set by the design owner on 2026-08-27, looking at the strip beside the plant
   * board: TOTAL 29 over RUNNING 20 and STOP 8 reads as an arithmetic error, and
   * the third slice - one machine in `Warning` - was being labelled "1 Other",
   * which named the leftover without explaining anything. The board next to it
   * has no third category at all.
   *
   * So the remainder is folded into STOP rather than printed beside TOTAL. What
   * that costs is worth stating: a machine in `No Plan`, `4M Change`, `Pending`,
   * `Alarm` or `Warning` now counts toward the figure an executive escalates on.
   * The defence is that none of them is producing, the card's own definition
   * line says "not running", and the ⓘ panel breaks the figure back down by
   * status - so the detail is one tap away rather than gone.
   *
   * The PAYLOAD is untouched: `counts.stopped` still means the `Stop` status
   * exactly, `by_status` still carries every status, and
   * `buckets-partition-total` still holds. This is a presentation rule, which is
   * why it lives here and not in domain/counts.ts - the server must keep
   * answering "how many machines are stopped" truthfully for anything else that
   * reads it.
   */
  const notRunning = machines - totals.counts.running;
  const stoppedShare = share(notRunning);
  /* The statuses actually behind the STOP figure, for its ⓘ panel - so folding
     them in is documented on the card rather than only in this comment. */
  const notRunningBreakdown = (Object.entries(totals.counts.by_status) as [MachineStatus, number][])
    .filter(([status, n]) => n > 0 && !RUNNING_STATUSES.has(status))
    .sort((a, b) => b[1] - a[1])
    .map(([status, n]) => `${status} ${int(n)}`)
    .join(' + ');
  // Group %OA against the served policy. `unknown` maps to neutral, so a payload
  // that cannot tier the figure draws no rail rather than guessing at one.
  const oaTone = TIER_TONE[totals.oa_tier];

  /*
   * The two gaps the strip stops making the reader work out.
   *
   * Both are subtractions a director was doing in their head off a screen that
   * had every input for them: %OA against a target that is 95 and not 100, and
   * actual against plan in six figures. Neither is derived from anything the
   * card does not already show, which is the test for whether a number belongs
   * on a card this size.
   *
   * Each is null the moment either side of it is, because R2 means a missing
   * value arrives as null and not as zero - and a gap computed against a
   * fabricated zero is the one number here that would be worse than no number.
   */
  const oaGap = totals.oa_pct === null ? null : totals.oa_pct - data.target_oa;
  const qtyGap =
    totals.plan_qty === null || totals.actual_qty === null
      ? null
      : totals.actual_qty - totals.plan_qty;

  return (
    <div className="kpis">
      <KpiCard
        labelKey="kpi.machines"
        measure={toMeasure(machines, online)}
        format={int}
        coverage={coverage}
        // This card's caption is the coverage statement, so the generic note
        // above it would print the same sentence twice.
        coverageNote="off"
        /* No remainder line any more: RUNNING + STOP is TOTAL by construction,
           so there is nothing left over to name. See `notRunning` above. */
        footKey="kpi.machines.connected"
        footParams={{ reporting: coverage.reporting, total: coverage.total }}
        /*
         * Neutral, and that is a deliberate loss. The caption used to turn amber
         * the moment coverage went partial, which is a real signal - "2 of 9
         * connected" in grey is a fact a reader can slide past. The redraw sets
         * both lead cards' captions in the same grey so the pair reads as one
         * object, and the coverage warning is carried instead by the amber
         * `.kpi__coverage` line every other card on the board still prints, by
         * the ⓘ panel here, and by the map's own uncommissioned marks.
         *
         * To put it back, restore:
         *   footTone={coverage.reporting < coverage.total ? 'warn' : 'good'}
         * `.kpi--feature .kpi__foot` does not override the tone classes, so the
         * prop is the only thing deciding this.
         */
        // Provenance, behind the ⓘ. This is the card the question gets asked of
        // first, because TOTAL is the one figure on the strip that is not simply
        // read off a machine - it is a rule about which machines count.
        infoKey="kpi.machines.source"
        mark="gear"
      />

      {/*
       * Share as the qualifier, definition as the foot. The share used to be a
       * whole sentence on the caption line - "83.1% of connected fleet" - and
       * the only part of it anybody read was the number; the column head above
       * it already says which fleet.
       */}
      <KpiCard
        labelKey="kpi.running"
        measure={toMeasure(totals.counts.running, online)}
        format={int}
        tone="good"
        coverage={coverage}
        coverageNote="off"
        meta={runningShare === null ? undefined : pct(runningShare)}
        metaTone="good"
        footKey="kpi.running.definition"
        /* The two statuses behind the figure, and how many of each. The caption
           already says "Mass Pro/Dandori", but the split is the part that
           changes what the number means: twenty-four running with six of them
           mid-mould-change is a different shift from twenty-four producing. */
        infoKey="kpi.running.source"
        infoParams={{
          massPro: int(totals.counts.by_status['Mass Pro']),
          dandori: int(totals.counts.by_status.Dandori),
        }}
        mark="play"
      />

      <KpiCard
        labelKey="kpi.stopped"
        measure={toMeasure(notRunning, online)}
        format={int}
        tone="critical"
        coverage={coverage}
        coverageNote="off"
        meta={stoppedShare === null ? undefined : pct(stoppedShare)}
        metaTone="critical"
        footKey="kpi.stopped.definition"
        /* The statuses folded into the figure, named. This card used to be a
           single status and needed no breakdown; now that it absorbs the
           remainder, a reader who wants to know whether "12" is twelve stops or
           eleven stops and a machine with no plan has to be able to find out. */
        infoKey="kpi.stopped.source"
        infoParams={{ breakdown: notRunningBreakdown || '-' }}
        mark="stop"
      />

      {/*
       * Tiered figure, tiered target - the whole card in one colour.
       *
       * The figure was deliberately black until 2026-09-03, on the argument that
       * a percentage is not a status until it is compared to its target, and
       * that the card around it should carry the comparison instead. The design
       * owner has reversed that: green at or above 90, amber from 75 to 89, red
       * below 75, on the figure itself.
       *
       * The argument it loses to is that this card sat in a row where RUNNING is
       * green and STOP is red at every value, so a black %OA did not read as
       * "deliberately neutral" - it read as the one card whose number nobody had
       * got round to colouring. A rule that holds for four cards and not the
       * fifth is not a rule a reader can learn.
       *
       * What it costs is worth recording: on a fleet in the 80s the strip now
       * shows amber next to green next to red, and the figure a director escalates
       * on - NEEDING ATTENTION - is no longer the only red number on the board.
       *
       * `tone` and not `tier`: the tone is already resolved above from
       * `oa.oaTier`, which is the *served* tier, so the three bands here are the
       * policy the backend sent rather than three numbers written into this file.
       * That is the whole of D-16 - the same %OA must not be amber here and green
       * on the operator's screen - and it is why the thresholds above appear in
       * this comment and nowhere in the code. See src/domain/tier.ts.
       *
       * `railTone` is gone with it, not lost: `rail` defaults to the figure's
       * tone, so the rail follows without being told. The target pill and the
       * delta take the same tone for the reason they always did - a green pill
       * under an amber figure would put the contradiction inside one card.
       *
       * The foot is D-19's caveat, which fits now that the target has moved up
       * off the caption line. It previously had nowhere to live but the
       * methodology dialog.
       */}
      <KpiCard
        labelKey="kpi.oa"
        measure={toMeasure(totals.oa_pct, online)}
        coverage={coverage}
        coverageNote="off"
        tone={oaTone}
        /*
         * The target, beside the figure rather than in the corner.
         *
         * It was in the corner and came off entirely for one release, because at
         * 1180px a 73px pill on the head left this card's label rendering as
         * "Av…". Losing it was worse than it looked: the delta says how far under
         * target the figure is, but with the pill gone nothing on the card said
         * what the target *was*, and "-8.6 pts" against an unstated number is
         * half a sentence.
         *
         * `metaAt="figure"` is the fix - the figure row has the width the head
         * does not, and the foot stays put, so the bottom line of all six cards
         * still reads across as one line.
         *
         * Tone follows the tier, the same as the rail and the delta. The three
         * were one decision: an amber rail under a neutral target would put the
         * contradiction inside a single card.
         */
        meta={t('kpi.target', { target: data.target_oa })}
        metaTone={oaTone}
        metaAt="figure"
        delta={oaGap === null ? undefined : t('kpi.oa.gap', { delta: formatSigned(oaGap, lang) })}
        deltaTone={oaTone}
        footKey="kpi.oa.definition"
        /*
         * The card that most needed this panel and was the last to get one.
         *
         * Its figure is the only one on the strip whose denominator is not the
         * fleet: %OA exists for a machine with an order loaded, and that is a
         * minority of the floor - four of twenty-nine on the plant this was
         * reconciled against. "91.6%" with no denominator invites the reading
         * that the factory is running at 91.6%, so the count goes in the rule
         * where a reader coming back to check will find it.
         *
         * `-` when the payload omits the count, which is what the mock does -
         * the same convention every unknown value on this board follows, and
         * better than a confident number nothing produced.
         */
        infoKey="kpi.oa.source"
        /* The one panel on the strip that opens with a definition list - three
           inputs named before the formula that combines them - and the only one
           that needs the extra width to keep them off two lines each. */
        infoWide
        /*
         * A ratio, not a bare count. "average of 6 machines" printed beside a
         * Total machine card reading 38 was a number with no denominator, and
         * the first question it drew was where the 6 came from. `machines` is
         * the strip's own TOTAL, so the two cards reconcile against each other
         * rather than sending the reader looking for a third number.
         */
        infoParams={{
          machines: totals.oa_machine_count === undefined ? '-' : int(totals.oa_machine_count),
          total: int(machines),
        }}
        mark="gauge"
      />

      {/*
       * Plan above, actual below: the two halves of one fraction, split across
       * the card so neither gets truncated. Section 8.5 - Shot and Pcs are
       * swapped in the source data often enough that the unit is always read
       * from the payload rather than assumed.
       */}
      <KpiCard
        labelKey="kpi.achievement"
        measure={toMeasure(totals.achievement_pct, online, { naReasonKey: 'measure.noPlan' })}
        coverage={coverage}
        coverageNote="off"
        /*
         * The plan, beside the figure - same move as %OA above, and this is the
         * card that forced it: "%Achievement" is the strip's longest label and a
         * "Plan 23,200" pill on the head left it 27px to render in.
         *
         * Neutral rather than toned. The plan is the denominator this figure is
         * computed against, not a judgement on it - the tone belongs to the
         * delta, which is the half that says whether the gap is good or bad.
         */
        meta={t('kpi.achievement.planShort', {
          qty: totals.plan_qty === null ? '-' : int(totals.plan_qty),
        })}
        metaAt="figure"
        delta={
          qtyGap === null
            ? undefined
            : t('kpi.achievement.gap', { delta: formatSigned(qtyGap, lang, 0) })
        }
        foot={t('kpi.achievement.actualUnit', {
          qty: totals.actual_qty === null ? '-' : int(totals.actual_qty),
          unit: t(`unit.${data.qty_unit}` as TKey),
        })}
        /*
         * The only ⓘ on the strip that has to correct its own label. The plan
         * is the loaded order's quantity, and the plant board calls the same
         * figure %AR (PROGRESS) - so a machine an hour into an 800-piece order
         * reads 12% while being perfectly on schedule. That is the number's
         * real meaning, not a caveat about it, and the caption has room for
         * neither. Until the label itself is settled it lives here.
         *
         * Both halves are re-stated inside the panel rather than only in the
         * corner and the foot: the panel is what a reader opens to check the
         * arithmetic, and a fraction is not checkable with one term missing.
         */
        infoKey="kpi.achievement.source"
        infoParams={{
          actual: totals.actual_qty === null ? '-' : int(totals.actual_qty),
          plan: totals.plan_qty === null ? '-' : int(totals.plan_qty),
        }}
        mark="target"
      />

      {/*
       * Naming the sites is the whole value of this card. A bare "1" tells an
       * executive to go looking; "ASI" tells them who to call. The badge is the
       * across-the-room half of the same message - it is only rendered when the
       * count is non-zero, so an empty corner means "nothing to do".
       */}
      <KpiCard
        labelKey="kpi.attention"
        measure={toMeasure(attention, online)}
        format={int}
        /*
         * Both numbers, because this card and the ranking's status chips answer
         * different questions and looked like they contradicted each other: this
         * counts the critical band, the chips count everything under target, and
         * on a fleet sitting in the 80s that is 0 against 3. The threshold is
         * named in the caption and the distinction is one hover away.
         */
        tooltipParams={{ threshold: data.tier_policy.warn_at, target: data.target_oa }}
        /*
         * The same two figures the tooltip takes, plus the plant count - which
         * is the answer to the question this card's number always raises next.
         * "One base needs attention" does not say whether that is one line or
         * twenty, and the payload has already counted it.
         *
         * Both thresholds are read from the served policy, never written into
         * the string: a hardcoded 75 in a help panel is the D-16 bug one
         * indirection further from the code that would contradict it.
         */
        infoKey="kpi.attention.source"
        /*
         * The bands are policy, not measurements - served (D-16) but fixed for
         * the life of the payload - so they print plain. Only the plant count
         * ticks, and it is the one figure here that earns the pill.
         */
        infoFixed={{
          good: data.tier_policy.good_at,
          warn: data.tier_policy.warn_at,
          // The top of the middle band, so the panel can print "75 to 89"
          // instead of making the reader work it out from two subtractions.
          warnTop: data.tier_policy.good_at - 1,
        }}
        infoParams={{ plants: int(totals.plants_needing_attention) }}
        tone={attention > 0 ? 'critical' : 'good'}
        footTone={attention > 0 ? 'critical' : 'good'}
        coverage={coverage}
        coverageNote="off"
        /*
         * The badge sits beside the figure, not in the corner - the one card on
         * the strip whose qualifier is not in the head.
         *
         * It was in the corner, and at 1180px it cost this card its label: the
         * badge is 48px of a 110px head and "Needing attention" rendered as
         * "Needing a…". The two cards that hit the same wall gave up their
         * qualifier for it (see %OA and %Achievement above), and this one does
         * not have to, because its figure is a single digit - 12px of a 152px
         * row, with 140px of nothing after it. The badge is the only qualifier
         * on the strip with somewhere else to go.
         *
         * Beside the number is arguably where it belonged anyway. The badge is
         * the across-the-room half of this card's message and the figure is the
         * other half; in the corner they were at opposite ends of the card.
         *
         * `delta` rather than `meta` is what puts it there - that slot is empty
         * on this card, it is already tone-classed, and it ranges left against
         * the figure. See `.kpi__delta` in components.css.
         */
        delta={
          attention > 0 ? <span className="kpi__badge">{t('kpi.attention.badge')}</span> : undefined
        }
        deltaTone="critical"
        /*
         * The site, where it is, and why it is red - "TH ASI 73.8%".
         *
         * The code alone told an executive to go looking; the figure beside it
         * is the reason the card is red, and it is the difference between "call
         * ASI" and "call ASI, they are eight points under the critical line".
         * Two sites still fit at the design width; three ellipsise, and the
         * ranking directly below names all of them either way.
         *
         * Filtered by `isRankable` as well as by tier, so the list cannot
         * disagree with the count above it: that is exactly how the backend
         * derives companies_needing_attention.
         */
        foot={
          attention === 0
            ? t('kpi.attention.none', { threshold: data.tier_policy.warn_at })
            : data.companies
                .filter((c) => isRankable(c.status) && c.kpi.oa_tier === 'critical')
                .map((c) =>
                  c.kpi.oa_pct === null
                    ? `${c.country_code} ${c.code}`
                    : `${c.country_code} ${c.code} ${pct(c.kpi.oa_pct)}`,
                )
                .join(' · ')
        }
        mark="bell"
      />
    </div>
  );
});
