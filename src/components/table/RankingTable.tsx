import { useState } from 'react';
import { Link } from 'react-router';
import type { CompanySummary, GlobalOverview, PlantSummary } from '../../api/contract';
import { useNow } from '../../domain/connectionState';
import { toMeasure } from '../../domain/measure';
import { isRankable, siteToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import { en, type TKey } from '../../i18n/en';
import {
  formatClockSeconds,
  formatDowntime,
  formatInt,
  formatWeekdayDate,
} from '../../i18n/format';
import { useLinkWithFilters } from '../../state/useFilters';
import { GrafanaLink } from '../common/GrafanaLink';
import { Flag } from '../primitives/Flag';
import { MeasureValue } from '../primitives/MeasureValue';
import { StatusGlyph } from '../primitives/StatusGlyph';
import { DEFAULT_SORT, nextSort, sortRows, type SortCol, type SortState } from './rankSort';

/**
 * Base ranking, worst %OA first by default, expandable to the plants underneath.
 *
 * Six columns plus a link, as the artboard draws them: identity, the site's own
 * date and clock, its run/stop split, %OA, %ACHV, and accumulated downtime.
 *
 * The Date/Time column is the one that earns its width - nine bases across seven
 * timezones genuinely span three calendar days at any given moment, and without
 * the local date beside the local clock a reader has no way to know whether
 * STJ's figures are from the same day as Ayutthaya's. The shift code shares that
 * cell rather than taking a column of its own, because "D" is two pixels of
 * information and the artboard is right to fold it in.
 *
 * Five structural decisions carry most of the value here.
 *
 * First, sites that are not reporting are not sorted among the performers. They
 * sit below an explicit divider that names how many there are and why. Sorting
 * nulls to the bottom of the same list reads as "these are the worst" rather
 * than "these are not measured" - with several bases un-commissioned that is the
 * single most expensive misreading available on this screen.
 *
 * Second, this is a real <table> with real <th scope="col">, laid out to the
 * artboard's column proportions through a colgroup. Nested CSS grids would give
 * a screen reader seven unrelated divs per row and no way to associate "76.2"
 * with "%OA" rather than "%ACHV".
 *
 * Third, the expander is a real <button> with aria-expanded inside the first
 * cell. A click handler on the <tr> cannot take focus, so the drill-down would
 * be unreachable by keyboard entirely.
 *
 * Fourth, the column heads sort. %OA worst-first is the order the board was
 * designed around and stays the default, but the same nine rows also answer "who
 * lost the most hours" and "where is THS" - see rankSort.ts. Tapping the head
 * rather than opening a picker is what keeps the control from ever covering the
 * rows it orders, and it is the pattern every table on the web already uses.
 *
 * Fifth - and this is what keeps the single-screen layout honest - the table
 * owns its own scroll region. Nine bases fit; expanding even one of them adds
 * four plant rows, and on a page with no scrollbar that content has nowhere to
 * go. It scrolls here, inside the panel, under a sticky header, so the panel's
 * outer height never changes and the map beside it never moves.
 */
export function RankingTable({ data }: { data: GlobalOverview | undefined }) {
  const { t, lang } = useI18n();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  /*
   * Open by default. All nine bases belong on the board - a panel listing three
   * of them, with the other six folded away behind a caret, reads as "the group
   * is three sites". The divider above them still does the work it was added
   * for: they are named as not-measured rather than ranked as worst.
   */
  const [showNotReporting, setShowNotReporting] = useState(true);
  /*
   * The order, owned here because the control that sets it is the table's own
   * column heads. It is component state and not a URL parameter: the filters in
   * the query string change what the API is asked for - and so what every KPI on
   * the board is divided by - while this changes nothing but the order of nine
   * rows already on screen.
   */
  const [sort, setSort] = useState<SortState>(DEFAULT_SORT);
  const link = useLinkWithFilters();

  /*
   * One second, because the clock column is the board's proof of life. Nine
   * frozen clocks are indistinguishable from a hung browser, which is the exact
   * ambiguity a board left up all day cannot afford. It is a clock, not a
   * reading - the age of the *data* is the live badge's job, and the whole view
   * desaturates when that goes stale.
   */
  const nowMs = useNow(1000);

  if (!data) return <div className="skeleton" style={{ flex: 1, minHeight: 0 }} />;

  /*
   * There is no empty branch here any more.
   *
   * This used to catch the one payload with no rows at all - the region
   * picker's All row tapped off - and say so next to the control that caused
   * it. That case is now answered a level up: OverviewPage returns EmptyState
   * for `companies.length === 0` before it renders this board at all, because a
   * region picked down to nothing empties the KPI strip, the map and the trend
   * too, and explaining that inside one of four blank panels left the other
   * three looking broken. This branch was unreachable the moment that landed.
   */

  const ranked = sortRows(
    data.companies.filter((c) => isRankable(c.status)),
    sort,
  );

  /*
   * Never sorted, and not by omission. These rows have no figures to order -
   * every metric cell on them is an em-dash - so any order the picker applied
   * would be arbitrary, or worse would read as a ranking of the sites that are
   * explicitly not ranked. They stay in payload order under the divider.
   */
  const notReporting = data.companies.filter((c) => !isRankable(c.status));

  const toggle = (code: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      // Keyed by company code, not by array index: the index of the *sorted*
      // array changes whenever %OA does, so a row's identity would too.
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });

  /** The country's name in the current language, falling back to its code. */
  const countryName = (code: string): string => {
    const key = `country.${code}`;
    return key in en ? t(key as TKey) : code;
  };

  return (
    <div className="panel__scroll">
      <table className="rank-table rank-table--fill">
        {/*
         * The artboard's column proportions. `table-layout: fixed` in the
         * stylesheet is what makes these authoritative rather than advisory, so
         * a long base name cannot widen the identity column and squeeze the
         * three numeric ones into ellipses.
         */}
        {/*
         * Measured, not guessed. Every one of these is the smallest share that
         * clears its column's actual content at 1180 with the cells' 16px of
         * padding on top - see the measurements in the identity note below.
         *
         * Re-cut once, against the max-content width of every column in both
         * languages rather than against the artboard's proportions. The two
         * percentage columns were the visible symptom: %OA had 12px it was not
         * using - its head is five characters and its widest value is "100.0%" -
         * while %ACHV was 5px short in English and 12px short in Thai, where the
         * head reads "%ตามแผน". A head squeezed to exactly its own width leaves
         * no gutter, which is what made the two figures read as one number.
         *
         * The columns are within a few px of their minimums now, so the shares
         * are one-decimal and they add to 100 on purpose. Moving one means
         * re-measuring the rest, not borrowing from whichever looks roomiest.
         */}
        <colgroup>
          {/* The widest column, and it grew again when the plant count became a
              chip beside the code rather than a superscript on it. It carries a
              caret, a flag, "SUS" + "6 plants", and "United States" under them -
              which ellipsised to "United S…" the last time it was starved.
              Needs 137px at 1180; gets 141. */}
          <col style={{ width: '24.5%' }} />
          {/* Two stacked lines, "Mon 24 Aug" over "D · 14:50:44". Needs 87. */}
          <col style={{ width: '15.3%' }} />
          {/* Run/Stop. Two pills on one line, and bare counts rather than
              "17 Run" - which is what released the ~60px the output column
              below needed. The pills shrink, so its floor is the pills at their
              own width plus the padding: 67px. */}
          <col style={{ width: '12%' }} />
          {/* %OA. The floor here is a value, not the head: "100.0%" is wider
              than "%OA" and its caret. 60px. */}
          <col style={{ width: '10.8%' }} />
          {/* %ACHV. The floor is the head, in Thai, with both sort carets on it:
              78px. This is the column the re-cut was for. */}
          <col style={{ width: '13.8%' }} />
          {/* The widest of the numeric columns, because on a plant row it is not
              a duration at all: it carries "5,761 / 6,400 pcs", the pair the
              %ACHV percentage was computed from. That pair and the "Downtime"
              head both want 110px, which it now has. */}
          <col style={{ width: '19.2%' }} />
          {/* The Grafana icon and its right padding. 24px. */}
          <col style={{ width: '4.4%' }} />
        </colgroup>
        <thead>
          <tr>
            <SortHead col="code" labelKey="table.base" className="col-id" />
            {/* Not sortable, and not an omission. Every base has its own clock,
                so ordering nine rows by "the time it is there" ranks them by
                timezone - a fact about geography that the column already states
                and that no reader has ever needed the rows arranged by. */}
            <th scope="col" className="col-time">
              {t('table.dateTime')}
            </th>
            <th scope="col">{t('table.runStop')}</th>
            <SortHead col="oa" labelKey="table.oa" className="num" />
            <SortHead col="achv" labelKey="table.achv" className="num" />
            <SortHead col="down" labelKey="table.down" className="num" />
            <th scope="col" className="col-link">
              <span className="visually-hidden">{t('common.grafana')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {ranked.map((c) => (
            <CompanyRows
              key={c.code}
              company={c}
              expanded={expanded.has(c.code)}
              onToggle={() => toggle(c.code)}
            />
          ))}

          {notReporting.length > 0 ? (
            <>
              <tr className="row-divider">
                <td colSpan={7}>
                  <button
                    type="button"
                    className="row-toggle"
                    aria-expanded={showNotReporting}
                    onClick={() => setShowNotReporting((v) => !v)}
                  >
                    <span className="row-toggle__caret" aria-hidden="true" />
                    {t('table.notReporting', { count: notReporting.length })}
                  </button>
                </td>
              </tr>
              {showNotReporting
                ? notReporting.map((c) => {
                    const token = siteToken(c.status);
                    return (
                      <tr key={c.code} className="row-quiet">
                        <td className="col-id">
                          <span className="rank-id">
                            <span className="rank-id__caret" aria-hidden="true" />
                            <Flag code={c.country_code} countryName={countryName(c.country_code)} />
                            <span className="rank-id__text">
                              <span className="rank-id__code">{c.code}</span>
                              {/* Still a link. A site with no gateway still has
                                  a page, and it is where its commissioning state
                                  is explained. */}
                              <Link
                                className="rank-id__country"
                                to={link(`/company/${c.code}`)}
                              >
                                {countryName(c.country_code)}
                              </Link>
                            </span>
                          </span>
                        </td>
                        {/*
                         * A site with no gateway still has a real local clock,
                         * and printing it is what stops "not connected" reading
                         * as "does not exist". Everything downstream of it is an
                         * em-dash, because there is nothing to divide.
                         */}
                        <td className="col-time">
                          <LocalDateTime company={c} nowMs={nowMs} />
                        </td>
                        <td className="cell-readiness">
                          <span style={{ color: token.inkVar }}>
                            <StatusGlyph token={token} showLabel />
                          </span>
                        </td>
                        <td className="num quiet">-</td>
                        <td className="num quiet">-</td>
                        <td className="num quiet">-</td>
                        <td className="col-link">
                          <GrafanaLink url={c.grafana_url} variant="icon" />
                        </td>
                      </tr>
                    );
                  })
                : null}
            </>
          ) : null}

          {/*
           * The slack absorber, and the reason a base row is the same height
           * whether NOT REPORTING is open or shut.
           *
           * .rank-table--fill is `height: 100%` so the ranking ends flush with
           * the map - and a table handed more height than its rows need shares
           * the surplus out among them, so folding the quiet sites away made
           * every base above the divider visibly taller. This row takes the
           * surplus instead: it has no content and no drawn height, so the
           * browser gives it the whole remainder and the data rows keep their
           * --row-h. When the content is genuinely taller than the panel - a
           * base expanded to its plants - there is no surplus, it collapses to
           * nothing, and the panel scrolls exactly as before.
           */}
          <tr className="row-filler" aria-hidden="true">
            <td colSpan={7} />
          </tr>
        </tbody>
      </table>
    </div>
  );

  /**
   * A column head that sorts, which is the whole control: tap the column, and
   * tap it again to reverse it.
   *
   * Standard because it is standard - a table head that sorts needs no
   * explaining, and unlike a dropdown it is never drawn over the rows it orders,
   * which on a panel this dense is the difference between choosing an order and
   * losing sight of the data while you choose it.
   *
   * Three details do the accessibility work, and none of them is the caret:
   *
   *   - `aria-sort` on the <th>, which is the one attribute a screen reader
   *     reads out as "sorted ascending". The glyph is decorative and marked so;
   *     a caret is not a state a screen reader can see.
   *   - A real <button> inside the cell. A click handler on the <th> takes no
   *     focus, so the entire sort control would be unreachable by keyboard.
   *   - The button fills the cell rather than wrapping the words, so the target
   *     is the whole column head. The header cannot grow to 44px without
   *     redrawing the table, and a 10px label is not a hit area on an iPad.
   *
   * The inactive heads carry a quiet pair of chevrons and the sorted one a
   * single chevron in the brand orange, so "which column is this ordered by" is
   * answerable from three metres without reading anything. Both marks are drawn
   * in CSS from this cell's own `aria-sort`, so the glyph cannot disagree with
   * the attribute - see .th-sort__glyph.
   */
  function SortHead({
    col,
    labelKey,
    className,
  }: {
    col: SortCol;
    labelKey: TKey;
    className?: string;
  }) {
    const active = sort.col === col;
    const label = t(labelKey);
    return (
      <th
        scope="col"
        className={[className, 'th-sortable', active ? 'is-sorted' : null]
          .filter(Boolean)
          .join(' ')}
        aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      >
        <button
          type="button"
          className="th-sort"
          onClick={() => setSort((s) => nextSort(s, col))}
          /* Says what the tap will do rather than repeating the label the button
             already announces: "%OA, button, Reverse the order". */
          title={active ? t('sort.reverse') : t('sort.by', { column: label })}
        >
          <span>{label}</span>
          <span className="th-sort__glyph" aria-hidden="true" />
        </button>
      </th>
    );
  }

  function CompanyRows({
    company,
    expanded: isOpen,
    onToggle,
  }: {
    company: CompanySummary;
    expanded: boolean;
    onToggle: () => void;
  }) {
    /*
     * One id per plant row, and aria-controls names all of them. An earlier
     * version put a single id on every row in the group, so a nine-base table
     * shipped thirty duplicate ids and aria-controls resolved to whichever the
     * browser found first.
     */
    const rowId = (plantCode: string) => `plant-${company.code}-${plantCode}`;
    const controls = company.plants.map((p) => rowId(p.code)).join(' ');
    const hasPlants = company.plants.length > 0;
    const country = countryName(company.country_code);
    /*
     * The same test the NEEDING ATTENTION card counts, so the strip's figure and
     * the tinted rows underneath it can never disagree. The tint is redundant by
     * design - the row already carries a critical glyph and critical ink in its
     * %OA cell - so it adds emphasis to a state that is legible without it.
     */
    const attention = company.kpi.oa_tier === 'critical';

    const plantCount = company.plants.length;

    /*
     * Two targets in one cell, so neither can wrap the other: the caret expands
     * the plant list, and the country line navigates to the site's own page.
     *
     * The whole identity block used to be the expander, which was a generous hit
     * area but left the drill-down reachable only from a map pin. Handing the
     * button to the caret alone costs nothing in practice - the .tap helper grows its 8px
     * glyph to a 44px hit area without redrawing it - and turns the second line
     * into the link its colour says it is.
     */
    const rowClass = [isOpen ? 'is-open' : null, attention ? 'row-attention' : null]
      .filter(Boolean)
      .join(' ');

    return (
      <>
        <tr className={rowClass || undefined}>
          <td className="col-id">
            <span className="rank-id">
              {hasPlants ? (
                <button
                  type="button"
                  className="rank-id__caret rank-id__caret--btn tap"
                  aria-expanded={isOpen}
                  aria-controls={controls || undefined}
                  onClick={onToggle}
                  title={t(isOpen ? 'table.collapse' : 'table.expand', { company: company.code })}
                >
                  {/* No content: the chevron is drawn in CSS. That also fixes
                      the button's accessible name, which was computed from the
                      glyph - a screen reader read this row's expander as
                      "black right-pointing triangle" and the title beside it
                      was never reached. Empty, the name falls through to the
                      title: "Expand THS". */}
                </button>
              ) : (
                <span className="rank-id__caret" aria-hidden="true" />
              )}

              <Flag code={company.country_code} countryName={country} />

              <span className="rank-id__text">
                <span className="rank-id__code">
                  {company.code}
                  {/* The plant count is the only cue on the row that there is
                      anything under the caret at all. */}
                  {hasPlants ? (
                    <span className="rank-id__plants">
                      {t(plantCount === 1 ? 'table.plants.one' : 'table.plants.other', {
                        count: plantCount,
                      })}
                    </span>
                  ) : null}
                </span>
                <Link className="rank-id__country" to={link(`/company/${company.code}`)}>
                  {country}
                </Link>
              </span>
            </span>
          </td>

          <td className="col-time">
            <LocalDateTime company={company} nowMs={nowMs} />
          </td>

          <td>
            <RunStop running={company.counts.running} stopped={company.counts.stopped} />
          </td>

          {/*
           * No tier shape here, at the client's direction: the tint alone marks
           * the tier in this column. The tier word still goes to assistive
           * technology, and the "no value" arms below keep their glyph - an
           * em-dash with nothing beside it is not a reading.
           */}
          <td className="num">
            <MeasureValue
              measure={toMeasure(company.kpi.oa_pct, company.status, { asOf: company.last_seen })}
              tier={company.kpi.oa_tier}
              showTierGlyph={false}
            />
          </td>

          <td className="num">
            <MeasureValue
              measure={toMeasure(company.kpi.achievement_pct, company.status, {
                asOf: company.last_seen,
                naReasonKey: 'measure.noPlan',
              })}
            />
          </td>

          <td className="num">
            <Downtime seconds={company.kpi.downtime_sec} />
          </td>

          <td className="col-link">
            <GrafanaLink url={company.grafana_url} variant="icon" />
          </td>
        </tr>

        {/* The same order as the table above, so a drill-down does not answer a
            different question than the row that opened it. One honest caveat:
            sorted by Downtime these rows are ordered by a figure they do not
            print - the sixth column carries output at plant level, by design -
            so the order is real but only checkable on the base row above. */}
        {isOpen
          ? sortRows(company.plants, sort).map((p) => (
              <PlantRow key={p.code} id={rowId(p.code)} company={company} plant={p} />
            ))
          : null}
      </>
    );
  }

  function PlantRow({
    id,
    company,
    plant,
  }: {
    id: string;
    company: CompanySummary;
    plant: PlantSummary;
  }) {
    return (
      <tr id={id} className="row-plant">
        <td className="col-id">
          <span className="plant-id">
            <span className="plant-id__tick" aria-hidden="true" />
            <Link
              to={link(`/company/${company.code}/plant/${plant.code}`)}
              className="plant-id__code"
            >
              {plant.code}
            </Link>
            <span className="plant-id__label">{plant.label}</span>
          </span>
        </td>

        {/* Last seen, not a clock: for a plant the useful fact is when it last
            spoke, and the site's clock is already on the row above. */}
        <td className="col-time tnum">
          {plant.last_seen === null ? (
            <span className="quiet">-</span>
          ) : (
            formatClockSeconds(plant.last_seen, company.timezone, lang)
          )}
        </td>

        <td>
          <RunStop running={plant.counts.running} stopped={plant.counts.stopped} />
        </td>

        <td className="num">
          <MeasureValue
            measure={toMeasure(plant.kpi.oa_pct, plant.status, { asOf: plant.last_seen })}
            tier={plant.kpi.oa_tier}
            showTierGlyph={false}
          />
        </td>

        {/*
         * Through MeasureValue, like every other figure on the board.
         *
         * This cell used to take `plant.kpi.achievement_pct` - a
         * `number | null` - test it for null itself and hand it to formatPct.
         * Three things came out of that, and only the third was visible:
         *
         *   - A plant that had gone quiet printed a confident %ACHV while %OA on
         *     the same row read "as of 8 minutes ago", because the raw formatter
         *     never sees `status`. That is the exact failure src/domain/measure.ts
         *     exists to make unrepresentable.
         *   - A null printed a bare dash with no reason attached, where the base
         *     row above it says "No plan".
         *   - It missed `.pct`, so the figure rendered at weight 400 in --sub
         *     while its neighbour was 600 - which is what "the %ACHV column is
         *     styled differently" turned out to be on these rows.
         */}
        <td className="num">
          <MeasureValue
            measure={toMeasure(plant.kpi.achievement_pct, plant.status, {
              asOf: plant.last_seen,
              naReasonKey: 'measure.noPlan',
            })}
          />
        </td>

        {/*
         * Output, not downtime - as drawn. At plant level the pair of numbers
         * the %ACHV percentage was computed from is the more useful fact, and
         * it is the only place on the board they appear. The unit comes from
         * the payload (section 8.5: Shot and Pcs get swapped in the source).
         */}
        <td className="num">
          <Output actual={plant.kpi.actual_qty} plan={plant.kpi.plan_qty} />
        </td>

        <td className="col-link" />
      </tr>
    );
  }

  /**
   * The run/stop split: two tinted pills carrying bare counts.
   *
   * The words came off at the client's direction - the column head reads
   * "Run/Stop", the order never varies, and on a table this dense the repeated
   * words were louder than the numbers they qualified.
   *
   * What stays is the accessible name. Each pill still contains its full
   * "17 Run" as visually-hidden text with the digits marked aria-hidden, so a
   * screen reader announces "17 Run, 3 Stop" rather than "17 3", which is the
   * one reading that would have been unrecoverable. Note this leaves the tint as
   * the only *visual* distinction, which src/domain/status.ts otherwise rules
   * out: --status-good-tint and --status-crit-tint are a near-identical pair to
   * a deuteranope, so the position and the column head are what carry the
   * mapping for a sighted reader now.
   */
  function RunStop({ running, stopped }: { running: number; stopped: number }) {
    const cell = (kind: 'run' | 'stop', value: number, key: TKey) => (
      <span className={`runstop__${kind}`}>
        <span aria-hidden="true">{formatInt(value, lang)}</span>
        <span className="visually-hidden">{t(key, { count: formatInt(value, lang) })}</span>
      </span>
    );
    return (
      <span className="runstop">
        {cell('run', running, 'table.run')}
        {cell('stop', stopped, 'table.stop')}
      </span>
    );
  }

  /** The site's own date over its own clock and shift code, ticking. */
  function LocalDateTime({ company, nowMs: at }: { company: CompanySummary; nowMs: number }) {
    const iso = new Date(at).toISOString();
    return (
      <span className="localtime">
        <span className="localtime__date">
          {formatWeekdayDate(iso, company.timezone, lang)}
        </span>
        <span className="localtime__clock">
          {company.shift ? (
            <>
              {/*
               * Code only. The full "B Shift (2 of 3)" belongs on the drill-down
               * and in the pin; at this width it would ellipsise to "B Shift (2
               * o…", and the cardinality is the half that would be lost. It
               * survives as the cell's tooltip.
               */}
              <span
                className="shift-code"
                title={t('shift.chipFull', {
                  label: company.shift.label,
                  index: company.shift.index,
                  of: company.shift.of,
                  time: formatClockSeconds(iso, company.timezone, lang),
                })}
              >
                {company.shift.code}
              </span>
              {' · '}
            </>
          ) : null}
          {formatClockSeconds(iso, company.timezone, lang)}
        </span>
      </span>
    );
  }

  /**
   * Accumulated downtime.
   *
   * Three outcomes, deliberately distinct. `null` is "nobody measured" and prints
   * an em-dash; `0` is "measured, and the line did not stop" and prints the word
   * rather than "0m", which reads as a placeholder; anything else is a real
   * duration in critical ink. Collapsing the first two is how sites with no
   * gateway come to look like the best-run sites in the group.
   */
  function Downtime({ seconds }: { seconds: number | null }) {
    if (seconds === null) return <span className="quiet">-</span>;
    if (seconds === 0) return <span className="quiet">{t('table.noDowntime')}</span>;
    return <span className="downtime">{formatDowntime(seconds)}</span>;
  }

  /** `4,732 / 5,200 pcs`, or an em-dash when either half is unknown. */
  function Output({ actual, plan }: { actual: number | null; plan: number | null }) {
    if (actual === null || plan === null) return <span className="quiet">-</span>;
    return (
      <span className="output">
        {formatInt(actual, lang)} / {formatInt(plan, lang)}{' '}
        <span className="quiet">{t(`unit.${data!.qty_unit}` as TKey)}</span>
      </span>
    );
  }
}
