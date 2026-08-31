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
 * (the label), what qualifies it (the meta, top right - a share, a target, a
 * plan, an alert), and what it excludes (the foot). Reading across the strip
 * therefore compares like with like, which is the reason the qualifier was
 * lifted off the caption line in the first place.
 *
 * Every card also divides by the reporting set, and the first card's caption -
 * "6 of 9 connected" - says so for the whole strip. It is the line that stops a
 * reader treating 65 machines as the group's machine count rather than its
 * *measurable* machine count, with three of nine bases still un-commissioned.
 * That card is the one with no meta, which is what leaves room for it.
 */
export function KpiStrip({ data }: { data: GlobalOverview | undefined }) {
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
        footTone={coverage.reporting < coverage.total ? 'warn' : 'good'}
        // Provenance, behind the ⓘ. This is the card the question gets asked of
        // first, because TOTAL is the one figure on the strip that is not simply
        // read off a machine - it is a rule about which machines count.
        infoKey="kpi.machines.source"
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
      />

      {/*
       * Black figure, tiered rail, tiered target. The number is not a status
       * until it is compared to that target, and the ranking below does that
       * per base with a glyph and a word - so the figure stays neutral while
       * the card around it carries the comparison. That is why the rail is the
       * one thing on this card set apart from the figure's own tone.
       *
       * What the rail follows is `totals.oa_tier`, resolved by the backend
       * against the same policy the map and the ranking are tiered by. It used
       * to be a hardcoded amber, which meant the card looked identical at 96%
       * and at 62% - a rail that never moves is not a signal, and a reader
       * learns to stop seeing it. Reading the served tier is also the only way
       * to colour this figure without reopening D-16: see src/domain/tier.ts.
       *
       * The target text takes the same tone. The two were one decision - amber
       * rail, amber target - and leaving the qualifier amber under a green rail
       * would put the contradiction inside a single card.
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
        railTone={oaTone}
        meta={t('kpi.target', { target: data.target_oa })}
        metaTone={oaTone}
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
        meta={t('kpi.achievement.planShort', {
          qty: totals.plan_qty === null ? '-' : int(totals.plan_qty),
        })}
        delta={
          qtyGap === null
            ? undefined
            : t('kpi.achievement.gap', {
                delta: formatSigned(qtyGap, lang, 0),
                unit: t(`unit.${data.qty_unit}` as TKey),
              })
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
        meta={
          attention > 0 ? <span className="kpi__badge">{t('kpi.attention.badge')}</span> : undefined
        }
        metaTone="critical"
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
      />
    </div>
  );
}
