import { useCallback, useEffect, useRef } from 'react';
import type { CompanySummary, PlantSummary } from '../../api/contract';
import { toMeasure } from '../../domain/measure';
import { isReporting, siteToken, tierToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import { en, type TKey } from '../../i18n/en';
import { formatDowntime, formatInt, formatPct, formatSigned } from '../../i18n/format';
import { useSelection } from '../../state/selectionStore';
import { useDisplayZone } from '../../state/useDisplayZone';
import { GrafanaLink } from '../common/GrafanaLink';
import { KpiMark, type KpiMarkName } from '../kpi/KpiMark';
import { CloseMark } from '../primitives/CloseMark';
import { Flag } from '../primitives/Flag';
import { MeasureValue } from '../primitives/MeasureValue';
import { ShiftChip } from '../primitives/ShiftChip';
import { StatusGlyph } from '../primitives/StatusGlyph';

/**
 * One base, in a panel that slides over the right-hand edge of the board.
 *
 * ## Why this and not a popup on the map
 *
 * The first version of this was a card anchored to the pin, and it had two
 * problems that no amount of placement logic fixes. It covered the map it was
 * describing - 230px of dialog in a 460px panel, over the three neighbours whose
 * cards the placement pass had just carefully moved clear of each other. And it
 * had nowhere to grow: a base's figures, its shift, its state and a route out to
 * Grafana do not fit in a box that also has to sit beside its own pin without
 * leaving the map.
 *
 * A drawer has the opposite constraint profile. It owns a full-height column at
 * the edge of the screen, so it can be typeset rather than crammed; the map keeps
 * its own geometry underneath and is simply dimmed; and on an iPad the gesture it
 * implies - something arriving from the edge, dismissed back to it - is the one
 * the platform has trained every reader to expect.
 *
 * ## What is in it, and what is deliberately not
 *
 * Four tiles, each carrying the figure and the thing that figure should be read
 * against: %OA against the target, %ACHV against the plan it was computed from,
 * the running count against the full census, and accumulated downtime - the one
 * number %OA excludes by construction (D-19), which is why it is a tile and not
 * a caption.
 *
 * Then one sentence of reading. It exists to state the *gap* - how far off target,
 * how far off plan - because that is the number an executive acts on and the only
 * thing in here that is not already a tile. Every clause is interpolated from a
 * real field and any clause whose field is null is dropped rather than defaulted.
 *
 * There is no "supervisory on duty" block, and its absence is a decision rather
 * than an omission. The design's section 10 records T-08: the previous dashboard
 * hardcoded `Contact: Pi Surapoj` into a screen that hangs in a factory corridor,
 * and the contract's response was to carry `{ role, team }` and never a person.
 * At company level it carries neither. A name, an extension and a radio channel
 * here would be three fabricated fields on the most authoritative-looking surface
 * on the board.
 *
 * Then the plants underneath the base, which is the other half of why a drawer
 * beats a popup on the map. The map is one pin per company because several plants
 * share a site (design doc section 3) and plant-level pins would land on top of
 * each other - so the map physically cannot show that THS is four plants. This is
 * the first place on the fleet board that says so without the reader expanding a
 * row in the ranking behind it.
 *
 * There is also no route through to the base's page or a plant's. Those pages have
 * nothing on them yet; when they do, the plant rows become links and a footer
 * action appears above the Grafana one.
 */
export function BaseDrawer({
  company,
  targetOa,
  qtyUnit,
  nowMs,
}: {
  /** The base to show, looked up fresh from the current payload by the caller. */
  company: CompanySummary | null;
  targetOa: number;
  qtyUnit: 'pcs' | 'shots';
  nowMs: number;
}) {
  const { t, lang } = useI18n();
  const displayZone = useDisplayZone();
  const close = useSelection((s) => s.close);
  const panel = useRef<HTMLDivElement>(null);

  /*
   * Focus moves in on open and the drawer is modal, so Tab has to be caught: the
   * board behind is inert to a reader's eye - dimmed, and covered - but not to
   * the tab order, and a cursor that walks off into a hidden ranking table is
   * lost with no way back that does not involve shift-tabbing blind.
   *
   * The list is recomputed on each keypress rather than cached on open. The
   * Grafana link disappears in kiosk mode and the payload can replace the whole
   * body on a poll; a cached list would trap focus against elements that are no
   * longer in the document.
   */
  const onKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;

      const stops = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      );
      if (stops.length === 0) return;
      const first = stops[0];
      const last = stops[stops.length - 1];
      // `activeElement` may be the panel itself, which is focusable but not in
      // the list - hence comparing against both ends rather than an index.
      if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) {
        e.preventDefault();
        last.focus();
      }
    },
    [close],
  );

  /*
   * Focus the panel, not the first control in it.
   *
   * The first control is the ✕, and announcing "Close, button" to somebody who
   * has just asked to read a base is answering a question they did not ask. The
   * panel carries the drawer's accessible name, so focusing it reads out which
   * base this is and that it is a dialog; Tab then reaches the ✕ and the link.
   *
   * Keyed on the company code and not on mount, because switching bases with the
   * drawer already open reuses this component - without the code in the
   * dependency list, focus would stay wherever it was and a screen reader would
   * never learn the panel now describes a different site.
   *
   * ## And hands it back on close
   *
   * `opener` is whatever had focus when the drawer took it, which is the pin card
   * that was tapped. Without this, closing dropped focus to <body> and a keyboard
   * reader was returned to the top of the document - having to tab past the
   * masthead, the filters and the KPI strip to get back to the map they were
   * reading.
   *
   * Remembered here rather than passed in by the pin, because the pin is not the
   * only thing that will open this: the ranking's rows are the obvious second
   * opener, and `document.activeElement` is right for both without either having
   * to know it is being tracked.
   */
  const code = company?.code ?? null;
  const opener = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!code) return;
    // Only on the way *in*. Switching bases with the drawer open must not
    // overwrite this with the panel itself, or closing would focus the drawer
    // that is being unmounted.
    if (!opener.current) opener.current = document.activeElement as HTMLElement | null;
    panel.current?.focus();
  }, [code]);

  useEffect(() => {
    if (code) return;
    // `isConnected` because the base may have left the payload while the drawer
    // was open - a region filter narrowing past it - in which case its pin is
    // gone and focusing it would throw focus to <body> anyway.
    const el = opener.current;
    opener.current = null;
    if (el?.isConnected) el.focus();
  }, [code]);

  if (!company) return null;

  const reporting = isReporting(company.status);
  const head = reporting ? tierToken(company.kpi.oa_tier) : siteToken(company.status);
  const country = countryName(company.country_code, t);
  const name = lang === 'th' && company.name_th ? company.name_th : company.name;
  const titleId = 'base-drawer-title';

  return (
    /*
     * The scrim dims the board and swallows clicks on it, and that is all it
     * does - it is deliberately not a "click anywhere to dismiss" target.
     *
     * It was one, and on the board it sits over that is a trap rather than a
     * convenience. The reader opens this from a pin or a ranking row, reads four
     * figures against the six on the strip behind it, and then goes to point at
     * one of them - and the panel they were comparing against vanishes under
     * their finger. On the iPad it is worse: the scrim covers the whole board,
     * so a palm resting on the glass while reading closes it.
     *
     * So dismissal is the ✕ and Escape, both of which are deliberate. It is a
     * plain div and `aria-hidden` because it is now purely decorative; nothing
     * here is reachable or announced.
     */
    <div className="drawer-scrim" aria-hidden="true">
      <div
        className="drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        ref={panel}
        onKeyDown={onKeyDown}
      >
        <div className="drawer__head">
          {/*
           * The state, as a pill, above the name rather than beside it. It is the
           * first thing the drawer says because it is the reason the reader
           * opened it, and a tinted pill is the one form on this board that can
           * carry a word at this weight without competing with the title.
           */}
          <span
            className="drawer__pill"
            style={{ color: head.inkVar, background: head.tintVar }}
          >
            <StatusGlyph token={head} showLabel />
          </span>

          <button
            type="button"
            className="drawer__close tap"
            onClick={close}
            title={t('drawer.close')}
          >
            <CloseMark />
            <span className="visually-hidden">{t('drawer.close')}</span>
          </button>

          <h2 className="drawer__title" id={titleId}>
            <Flag code={company.country_code} countryName={country} size="1em" />
            <span className="drawer__code">
              {company.country_code} {company.code}
            </span>
            <span className="drawer__country">({country})</span>
          </h2>

          <p className="drawer__sub">
            {name}
            {/* The shift is identity, not a metric: "B Shift (2 of 3)" is what
                makes a cross-site comparison of shift totals honest, and it
                belongs on the subtitle line with the plant it describes. */}
            {reporting ? (
              <>
                {' · '}
                <ShiftChip
                  shift={company.shift}
                  timeZone={displayZone(company.timezone)}
                  nowMs={nowMs}
                  variant="row"
                />
              </>
            ) : null}
          </p>
        </div>

        <div className="drawer__body">
          {reporting ? (
            <>
              <div className="drawer__tiles">
                <Tile
                  mark="gauge"
                  label={t('drawer.oa')}
                  caption={t('kpi.target', { target: targetOa })}
                  value={
                    <MeasureValue
                      measure={toMeasure(company.kpi.oa_pct, company.status, {
                        asOf: company.last_seen,
                      })}
                      tier={company.kpi.oa_tier}
                      emphasis="kpi"
                      showTierGlyph={false}
                    />
                  }
                />

                {/* `stop`, which is the mark the strip's Stop card carries -
                    accumulated downtime is the time this base spent in it. */}
                <Tile
                  mark="stop"
                  label={t('drawer.downtime')}
                  caption={t('drawer.downtime.note')}
                  value={
                    company.kpi.downtime_sec === null ? (
                      <span className="quiet">-</span>
                    ) : company.kpi.downtime_sec === 0 ? (
                      <span className="quiet">{t('table.noDowntime')}</span>
                    ) : (
                      <span className="downtime">
                        {formatDowntime(company.kpi.downtime_sec)}
                      </span>
                    )
                  }
                />

                {/* running / total, never running / (run + stop): the mockup's
                    `machines = run + stop` drops No Plan, Order End and 4M
                    Change, which is the Q-08 trap `counts` exists to close. */}
                <Tile
                  mark="play"
                  label={t('drawer.machines')}
                  caption={t('drawer.machines.note', {
                    stopped: formatInt(company.counts.stopped, lang),
                    idle: formatInt(company.counts.idle + company.counts.other, lang),
                  })}
                  value={
                    <span className="tnum">
                      {formatInt(company.counts.running, lang)}
                      <span className="drawer__of"> / {formatInt(company.counts.total, lang)}</span>
                    </span>
                  }
                />

                <Tile
                  mark="target"
                  label={t('drawer.achv')}
                  caption={
                    company.kpi.actual_qty === null || company.kpi.plan_qty === null
                      ? undefined
                      : t('drawer.achv.note', {
                          actual: formatInt(company.kpi.actual_qty, lang),
                          plan: formatInt(company.kpi.plan_qty, lang),
                          unit: t(`unit.${qtyUnit}` as TKey),
                        })
                  }
                  value={
                    <MeasureValue
                      measure={toMeasure(company.kpi.achievement_pct, company.status, {
                        asOf: company.last_seen,
                        naReasonKey: 'measure.noPlan',
                      })}
                      emphasis="kpi"
                    />
                  }
                />
              </div>

              <Reading company={company} targetOa={targetOa} />

              {/* One plant is not a list. THS has four and ASI has one, and
                  printing a heading over a single row that repeats the base
                  above it is furniture rather than information. */}
              {company.plants.length > 1 ? (
                <section className="drawer__plants">
                  <h3>{t('drawer.plants', { count: company.plants.length })}</h3>
                  {company.plants.map((p) => (
                    <PlantRow key={p.code} plant={p} />
                  ))}
                </section>
              ) : null}
            </>
          ) : (
            /*
             * A base with no gateway. Every tile above would be an em-dash and
             * the machine one would read "0 / 0", so it gets the two facts it
             * does have instead - and they are sentences, which is why this is a
             * definition list and not the tile grid.
             */
            <dl className="drawer__facts">
              <dt>{t('map.pop.rollout')}</dt>
              <dd>{t(`readiness.${company.data_readiness}` as TKey)}</dd>
              <dt>{t('map.pop.telemetry')}</dt>
              <dd>{company.last_seen === null ? t('site.neverConnected') : t('site.stale')}</dd>
            </dl>
          )}
        </div>

        {/*
         * The footer holds whatever routes out of here, and today that is one
         * link - GrafanaLink renders nothing when the payload carries no URL and
         * nothing at all in kiosk mode, so on a wall panel this bar is empty and
         * the CSS lets it collapse.
         */}
        <div className="drawer__foot">
          <GrafanaLink url={company.grafana_url} variant="chip" />
        </div>
      </div>
    </div>
  );
}

/**
 * One plant under the base.
 *
 * Its own %OA and its own run/stop split, because the whole point of listing them
 * is that a base's figure is an average: THS at 83% can be four plants at 83% or
 * three at 90% and one at 62%, and those are different mornings. The row is
 * deliberately not a link yet - see the note at the top.
 *
 * `plant.status`, not the company's. A plant may be dark while its siblings
 * report (that is what `degraded` means on the parent), and rendering its %OA
 * through the company's status would print the company's "not connected" over a
 * plant that is fine, or a figure over a plant that is not.
 */
function PlantRow({ plant }: { plant: PlantSummary }) {
  const { lang } = useI18n();
  return (
    <div className="drawer__plant">
      <span className="drawer__plant-id">
        <span className="drawer__plant-code">{plant.code}</span>
        <span className="drawer__plant-label">{plant.label}</span>
      </span>
      <span className="drawer__plant-run tnum">
        {formatInt(plant.counts.running, lang)}
        <span className="drawer__of"> / {formatInt(plant.counts.total, lang)}</span>
      </span>
      <span className="drawer__plant-oa">
        <MeasureValue
          measure={toMeasure(plant.kpi.oa_pct, plant.status, { asOf: plant.last_seen })}
          tier={plant.kpi.oa_tier}
          emphasis="inline"
          showTierGlyph={false}
        />
      </span>
    </div>
  );
}

/**
 * One figure, its label, and the thing it should be read against.
 *
 * It renders the strip's own card - `.kpi.kpi--feature`, the classes KpiCard
 * puts on the six cards on the board behind this panel - rather than a
 * drawer-local card built to resemble one. A base's %OA and the group's %OA are
 * the same quantity at two scopes, and the whole use of this drawer is reading
 * one against the other across the scrim; two cards drawn to two specifications
 * is the thing that makes that comparison harder than it is.
 *
 * Not `<KpiCard>` itself, which is a different question. That component takes a
 * `Measure` and a `coverage` and owns a tooltip, a provenance popover and a
 * coverage note - machinery for a card that is the board's primary reading. What
 * a tile needs is the shape and the type, and those live in the CSS.
 *
 * The mark is required rather than optional. KpiCard's note on `mark` records
 * that the mark, the sentence-case label and the larger figure are one decision
 * and that a card in this style without one has a hole where it goes; making it
 * optional here would be an invitation to open that hole.
 */
function Tile({
  mark,
  label,
  value,
  caption,
}: {
  /** The subject mark, top left. See the note above on why there is no default. */
  mark: KpiMarkName;
  label: string;
  value: React.ReactNode;
  caption?: string;
}) {
  return (
    <div className="kpi kpi--feature drawer__tile">
      <div className="kpi__head">
        {/* The title group the strip uses, minus the ⓘ: what a figure means is
            answered once, on the card of the same name on the board behind
            this panel, and a second copy of that popover inside a modal is a
            dialog opening over a dialog. */}
        <div className="kpi__title">
          <KpiMark name={mark} />
          <div className="kpi__label">{label}</div>
        </div>
      </div>

      <div className="kpi__value">{value}</div>

      {caption ? <div className="kpi__foot">{caption}</div> : null}
    </div>
  );
}

/**
 * One sentence of reading, tinted by tier.
 *
 * The gap to target and the gap to plan, which are the two figures a reader has
 * to do arithmetic for otherwise - and the two that decide whether anyone walks
 * over. Nothing here is generated prose: each clause is a template with a real
 * number in it, and a clause whose number is null is not rendered.
 *
 * Deliberately no clause about causes. "Zero active mold anomalies" is the kind
 * of sentence this space invites and the payload cannot support it; the alert
 * list on the other board is where open stops are named.
 *
 * And deliberately no tier word of its own. It had one, and it read
 * "ON TARGET · %OA is -1.9 points against the 95% target" - two true statements
 * that look like a contradiction, because the tier band is target-5 (D-16) and
 * nothing in three words explains that. The pill at the top of the drawer already
 * says which tier this is; the sentence's job is the arithmetic under it.
 */
function Reading({ company, targetOa }: { company: CompanySummary; targetOa: number }) {
  const { t, lang } = useI18n();
  const { oa_pct, achievement_pct, oa_tier } = company.kpi;
  /* Only the tint is taken from the tier here - see the note above on why the
     word is not. */
  const token = tierToken(oa_tier);

  const clauses: string[] = [];

  if (oa_pct !== null) {
    // Signed, so the sentence needs no "above"/"below" of its own - and a base
    // exactly on target reads "0.0 points", which is the honest rendering of a
    // gap that has closed rather than a claim that there never was one.
    clauses.push(
      t('drawer.read.oa', {
        delta: formatSigned(oa_pct - targetOa, lang),
        target: targetOa,
      }),
    );
  }
  if (achievement_pct !== null) {
    clauses.push(
      t(achievement_pct >= 100 ? 'drawer.read.planMet' : 'drawer.read.planShort', {
        pct: formatPct(achievement_pct, lang),
      }),
    );
  }
  if (clauses.length === 0) return null;

  return (
    <div className="drawer__reading" style={{ background: token.tintVar }}>
      <p>{clauses.join(' ')}</p>
    </div>
  );
}

/** The country's name in the current language, falling back to its code. */
function countryName(code: string, t: (key: TKey) => string): string {
  const key = `country.${code}`;
  return key in en ? t(key as TKey) : code;
}
