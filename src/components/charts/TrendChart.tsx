import { memo, useCallback, useId, useLayoutEffect, useMemo, useState } from 'react';
import type { TrendPoint } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import {
  formatClock,
  formatDayShort,
  formatPct,
  formatSigned,
  zoneAbbrev,
  zoneHour,
} from '../../i18n/format';
import {
  extremesOf,
  fullCeiling,
  overflowOf,
  timeTickIndices,
  trendDomain,
  withCeiling,
  yTicks,
} from './trendScale';
import { StatusIcon } from '../primitives/StatusIcon';

/**
 * Hourly %OA trend.
 *
 * Hand-rolled SVG rather than a charting library: the shape needed is one line,
 * two thresholds and a fill, and every library on the market brings a theming
 * layer that would fight the design tokens.
 *
 * Four things here are decisions rather than drawing.
 *
 * The y-domain is derived, not hardcoded. The mockup pinned `min=45, max=100`,
 * so any hour below 45% was clipped off the bottom edge and simply did not
 * appear - a plant having a catastrophic shift is the one case where the chart
 * must not quietly flatten. The padding is deliberately asymmetric: a trend
 * running under its target needs room below the line, not a third of the panel
 * left empty above a threshold nothing reaches.
 *
 * The axis is drawn in one reference zone and says which one (D-04), because
 * twenty-four hours of "local time" across seven timezones is not a coherent
 * axis. It ticks every sixth hour of that zone rather than only at its ends, so
 * "the dip was the night shift" is readable off the chart instead of inferred.
 *
 * The series is blue and not green. See --trend-line in tokens.css: a green line
 * under a target it never reaches is a claim contradicted by every point on it.
 * The hours that genuinely are a status - below the *served* warn_at, never a
 * constant recomputed here (D-16) - are overdrawn in the critical mark, which is
 * why the legend names that threshold whenever an hour crosses it.
 *
 * The hover read-out is additive. Nothing here is reachable only by hovering:
 * the peak, the low and the 24 h average are drawn or printed on the panel, and
 * the table twin carries every hour.
 */

/*
 * The narrowest the y-axis gutter is allowed to get. It is a floor and not the
 * gutter itself: at kiosk density the axis labels are 18px, "100" is wider than
 * this, and the artboard's fixed 34 clipped it to "L00" on the one screen that
 * is read from three metres away. The real width is measured - see `gutter`.
 */
const PAD_X_MIN = 34;
const PAD_RIGHT = 12;
const PAD_TOP = 14;
const PAD_BOTTOM = 26;

/*
 * The plot has to be at least this big before the peak and low get labelled.
 *
 * The same component draws the overview's half-board and the company page's
 * 150px strip. On the strip the two labels, the target label, five gridline
 * figures and five clock labels are competing for the same ink, and the answer
 * there is fewer marks and a table twin one tap away - not cleverer placement.
 */
const ANNOTATION_MIN_W = 320;
const ANNOTATION_MIN_H = 190;

/* Fallback until the first measurement lands; also the size used in tests. */
const FALLBACK = { w: 600, h: 150 };

interface Props {
  points: TrendPoint[];
  target: number;
  /**
   * The served tier boundary below which an hour is critical. Passed in rather
   * than derived: two constants in two codebases is exactly the bug D-16 exists
   * to close, so this is `tier_policy.warn_at` off the payload and nothing else.
   */
  warnAt: number;
  /**
   * The clock the axis, the tooltip and the table view are printed on, resolved
   * by the caller through `useDisplayZone`.
   *
   * A site's chart follows the reader's time mode. The fleet chart on the
   * overview does not and cannot: its hours are an aggregate over nine bases
   * spanning UTC+01 to UTC-06, so there is no local clock to switch to and the
   * caller hands it the reference zone in both modes. That is why `tz` below is
   * printed beside the hovered reading rather than assumed.
   */
  timeZone: string;
}

/*
 * Memoised, and this is the one on the board where it matters most.
 *
 * Both boards stay mounted - the inactive one is `hidden`, so the map keeps its
 * pan and zoom - which means this chart was re-deriving its path geometry, its
 * average, its peak and its low once a second while nobody was even looking at
 * the tab it sits on. `points` comes memoised out of `useTrendWindow` and the
 * rest are numbers, so it now recomputes when the trend or the window moves.
 */
export const TrendChart = memo(function TrendChart({ points, target, warnAt, timeZone }: Props) {
  const { t, lang } = useI18n();
  const [asTable, setAsTable] = useState(false);

  /* Which hour the pointer is over. Null is the resting state, not hour zero. */
  const [hover, setHover] = useState<number | null>(null);

  /*
   * The axis ceiling the reader has asked for, `null` while it is derived.
   *
   * Null rather than "the fitted value" so the chart keeps following the data
   * until somebody actually intervenes: a window change that moves the fitted
   * ceiling should move the axis with it, not leave it pinned to a number that
   * was right for a different fifteen hours. Dragging back to the left end
   * returns to null rather than parking on today's fitted figure, for the same
   * reason - that is what makes the control's left stop mean "auto".
   */
  const [ceiling, setCeiling] = useState<number | null>(null);

  /* Two charts can be mounted at once (overview and company detail), and a
     duplicated gradient id would have them share one fill and one clip. */
  const uid = useId();
  const fillId = `trend-fill-${uid}`;
  const zoomId = `trend-zoom-${uid}`;
  const clipId = `trend-below-${uid}`;

  /*
   * The viewBox tracks the element's real pixel box rather than being fixed at
   * 600x150 and stretched to fit. It used to be the latter, which was harmless
   * while the panel was a fixed 150px tall - now that the chart fills whatever
   * the board has spare, a fixed viewBox with preserveAspectRatio="none" scales
   * the y-axis by 4x and drags every label and stroke out of shape with it.
   * One unit here is one pixel, so type and line weights stay true at any size.
   */
  /*
   * The plot's node is held in state and set by a callback ref, rather than in
   * a `useRef` that an effect reads once - and that difference is a bug rather
   * than a preference.
   *
   * This component swaps its plot node out without ever unmounting: the
   * `usable.length < 2` guard below returns a paragraph instead of the chart
   * whenever the picked window comes back with fewer than two readings, and the
   * table twin replaces the whole subtree. An effect keyed on mount observes
   * the node that existed at mount; when the plot came back React had built a
   * *new* div and the ResizeObserver was still watching the detached one. No
   * measurement ever landed again, so the viewBox stayed at FALLBACK - 600x150
   * stretched across a 1000x430 panel by `preserveAspectRatio="none"`, which is
   * exactly the chart drawn at three times its type size that a reader reports,
   * and exactly why reloading the page "fixes" it: a reload is a fresh mount.
   *
   * A callback ref re-runs the effect against whichever node is on screen now,
   * so the observer cannot be left watching a corpse.
   */
  const [plotEl, setPlotEl] = useState<HTMLDivElement | null>(null);
  const [size, setSize] = useState(FALLBACK);

  /*
   * The y-axis gutter, measured off a hidden three-digit probe rather than
   * guessed from the density.
   *
   * The probe is a stable node with a stable string, which is what makes this
   * safe: observing a real tick label would mean re-attaching the observer every
   * time the domain shifts and re-measuring on a value that may be two digits
   * today and three tomorrow. Reserving room for "100" at all times also keeps
   * the plot from jiggling sideways when the domain moves under it.
   */
  const [probeEl, setProbeEl] = useState<SVGTextElement | null>(null);
  const [gutter, setGutter] = useState(PAD_X_MIN);

  useLayoutEffect(() => {
    if (!probeEl) return;
    const apply = (w: number) => {
      /* Zero is the probe not being rendered, not a label with no width. */
      if (!(w > 0)) return;
      const next = Math.max(PAD_X_MIN, Math.ceil(w) + 10);
      setGutter((prev) => (prev === next ? prev : next));
    };
    /* SVG geometry, so the first measurement is taken in user units with
       `getBBox`. `getBoundingClientRect` would come back multiplied by whatever
       the viewBox is currently scaled to, and the gutter is a viewBox figure -
       feeding one into the other is how a self-inflating axis starts. */
    if (typeof probeEl.getBBox === 'function') apply(probeEl.getBBox().width);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => apply(entry.contentRect.width));
    ro.observe(probeEl);
    return () => ro.disconnect();
  }, [probeEl]);

  useLayoutEffect(() => {
    if (!plotEl) return;
    /*
     * A zero box is the absence of a measurement, not a measurement of zero.
     * Both boards stay mounted and the one behind is `hidden`, so this panel
     * reports 0x0 for as long as the reader is on the other tab. Rounding that
     * up through the 240x90 floors would overwrite a real box with a fabricated
     * one; dropping it keeps the last true size until the panel is shown again
     * and the observer reports for real.
     */
    const apply = (width: number, height: number) => {
      if (!(width > 0) || !(height > 0)) return;
      const next = {
        w: Math.max(240, Math.round(width)),
        h: Math.max(90, Math.round(height)),
      };
      // Guard the update, or a rounding wobble becomes a render loop.
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    };
    /* Measured here as well as observed, so the first frame after the node
       appears is already drawn against its own box. The observer would land a
       frame later, and that frame is the fallback stretched over the panel. */
    const box = plotEl.getBoundingClientRect();
    apply(box.width, box.height);
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) =>
      apply(entry.contentRect.width, entry.contentRect.height),
    );
    ro.observe(plotEl);
    return () => ro.disconnect();
  }, [plotEl]);

  /*
   * The table twin opens at its foot, not its head.
   *
   * The rows run oldest-first because the chart they stand in for reads
   * left-to-right, and a twin that reads the other way makes the reader flip
   * the axis in their head every time they toggle. What that ordering costs is
   * the one row anyone actually came for: the latest hour sits off the bottom
   * of a scroller showing seven of twenty-four rows, and a value you have to go
   * hunting for is the value the panel reports worst.
   *
   * A callback ref rather than an effect, because what is being waited on is
   * the node arriving, not the component mounting - this subtree is swapped in
   * and out while the component itself stays mounted, so an effect keyed on
   * mount would never see it. And a *stable* callback, because an inline one is
   * a new function every render: React would detach and re-attach the node on
   * each refresh and drag the reader back to the foot mid-read. Held by
   * `useCallback`, it runs when the table opens and not again.
   */
  const openAtFoot = useCallback((el: HTMLDivElement | null) => {
    /* Not a follow, only the opening position - and the window slides rather
       than grows, so a reader left at the foot stays there unaided. */
    if (el) el.scrollTop = el.scrollHeight;
  }, []);

  const { w: W, h: H } = size;

  const usable = useMemo(() => points.filter((p) => p.oa_pct !== null), [points]);

  /* `machine_count` is optional on the contract - a backend that predates it
     sends none, and the column and the tooltip line stay off rather than
     printing a dash twenty-four times. */
  const anyMachineCount = useMemo(
    () => points.some((p) => p.machine_count !== undefined),
    [points],
  );

  /* Scale arithmetic lives in trendScale.ts, where it is under test. */
  const oaValues = useMemo(() => usable.map((p) => p.oa_pct as number), [usable]);

  /* What the data asks for. The reader's ceiling is applied on top of this
     rather than replacing it, so the floor never moves under the pointer. */
  const fitted = useMemo(() => trendDomain(oaValues, target), [oaValues, target]);

  /* The far end of the zoom: the ceiling at which nothing is off-scale. */
  const ceilingMax = useMemo(() => fullCeiling(oaValues, fitted), [oaValues, fitted]);

  /*
   * Only offered when there is something above the fitted ceiling to go and
   * look at. A slider whose two ends draw the same chart is a control that
   * teaches the reader it does nothing.
   *
   * Note this is asked of the FITTED domain, never the current one: basing it
   * on what is off-scale right now would make the control vanish the moment it
   * was dragged far enough to work, and snap the axis back under the pointer.
   */
  const zoomable = ceilingMax > fitted.max;

  const domain = useMemo(() => {
    if (ceiling === null || !zoomable) return fitted;
    return withCeiling(fitted, Math.min(Math.max(ceiling, fitted.max), ceilingMax));
  }, [fitted, ceiling, zoomable, ceilingMax]);

  const gridlines = useMemo(() => yTicks(domain), [domain]);

  /* Resolving the zone hour is the component's job - it is the one part that
     needs Intl. WHICH zone is the caller's, not a deploy-time constant: see the
     prop doc above and src/state/useDisplayZone.ts. */
  const xTicks = useMemo(
    () => timeTickIndices(points.map((p) => zoneHour(p.ts, timeZone))),
    [points, timeZone],
  );

  /*
   * Which of the two axis labels to print.
   *
   * A chart a day wide or less is a chart of clock times, and `14:00` is what
   * places a dip against a shift. Past that the ticks land on midnights, and
   * seven labels all reading `00:00` say nothing about WHICH midnight - so the
   * axis switches to dates. The threshold is the span the points actually
   * cover, not the window that was asked for: a seven-day pick that only
   * returned four hours of buckets should still be labelled in hours.
   */
  const spansDays = points.length > 26;

    const extremes = useMemo(() => extremesOf(points.map((p) => p.oa_pct)), [points]);

  const average = useMemo(() => {
    if (usable.length === 0) return null;
    return usable.reduce((sum, p) => sum + (p.oa_pct as number), 0) / usable.length;
  }, [usable]);

  const anyCritical = useMemo(
    () => usable.some((p) => (p.oa_pct as number) < warnAt),
    [usable, warnAt],
  );

  if (usable.length < 2) {
    return (
      <p className="error-state" style={{ padding: 'var(--sp-5)' }}>
        {t('trend.insufficient')}
      </p>
    );
  }

  const x = (i: number) => gutter + (i * (W - gutter - PAD_RIGHT)) / (points.length - 1);
  const y = (v: number) =>
    H - PAD_BOTTOM - ((v - domain.min) / (domain.max - domain.min)) * (H - PAD_TOP - PAD_BOTTOM);
  const clampToDomain = (v: number) => Math.min(Math.max(v, domain.min), domain.max);

  /*
   * Every reading is plotted at its CLAMPED height.
   *
   * It used to be plotted raw, which was invisible while the domain was pinned
   * at 0..100 and every %OA happened to fit under it. Once an hour came in at
   * 392% (a machine running three PO slots in one shot - D-27) the point was
   * drawn at a negative y, outside the viewBox, and the polyline came out flat
   * along the top edge. A reader cannot tell that flat from a real plateau, so
   * the chart was making a claim about production out of the paper edge.
   *
   * Clamping puts the point on the top rail instead, where `overflow` marks it
   * with a caret and the legend says how many hours are up there and how high
   * the highest one went. The line still bends towards it, the value is still
   * exact in the tooltip, the annotation and the table twin - what is lost is
   * only the vertical distance, which the axis could not have shown legibly at
   * any scale that also kept the 80-110% band readable.
   */
  const yClamped = (v: number) => y(clampToDomain(v));

  const line = points
    .map((p, i) => (p.oa_pct === null ? null : `${x(i)},${yClamped(p.oa_pct)}`))
    .filter(Boolean)
    .join(' ');

  /* The hours sitting on the rail rather than at their own height. */
  const overflow = overflowOf(points.map((p) => p.oa_pct), domain);

  const targetY = y(clampToDomain(target));
  const warnY = y(clampToDomain(warnAt));
  const baseline = H - PAD_BOTTOM;
  const lastIndex = points.length - 1;
  const tz = zoneAbbrev(points[0].ts, timeZone);
  const annotate = W >= ANNOTATION_MIN_W && H >= ANNOTATION_MIN_H;

  /* A point's colour carries the one status the series has: below the served
     warn_at it is critical, and above it the figure is just a measurement. */
  const markFor = (v: number) => (v < warnAt ? 'var(--status-crit-mark)' : 'var(--trend-line)');

  /* Keeps a label inside the plot instead of half-printed past its edge. */
  const anchorFor = (px: number): 'start' | 'middle' | 'end' => {
    if (px < gutter + 34) return 'start';
    if (px > W - PAD_RIGHT - 34) return 'end';
    return 'middle';
  };

  /*
   * Coverage changes are a real trap: when a new base comes online the line
   * steps because the denominator changed, not because anything improved.
   *
   * The pair is "how many sites the newest hour was measured over, out of the
   * most any hour on this chart was". Both halves used to read the same
   * `site_count`, which printed "Coverage 1 of 1 sites" - a warning that
   * contradicted itself. It never showed against the mock, whose site count is
   * constant for all 24 points; the live payload moves between 1 and 2 as ASI's
   * machines pick up and drop orders, which is what surfaced it.
   */
  const siteCounts = points.filter((p) => p.oa_pct !== null).map((p) => p.site_count);
  const coverageChanged = new Set(siteCounts).size > 1;
  const coverageMax = siteCounts.length === 0 ? 0 : Math.max(...siteCounts);

  const hovered = hover === null ? null : points[hover];

  /** Nearest hour to a pointer position. The viewBox is 1:1 with pixels. */
  const indexAt = (clientX: number): number | null => {
    const el = plotEl;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    const inner = rect.width - gutter - PAD_RIGHT;
    if (inner <= 0) return null;
    const frac = (clientX - rect.left - gutter) / inner;
    return Math.min(lastIndex, Math.max(0, Math.round(frac * lastIndex)));
  };

  /* What a screen reader gets instead of the picture: the same three figures
     the sighted reader gets off the annotations. */
  const summary = [
    t('trend.title'),
    t('trend.axis', { tz }),
    average === null ? '' : `${t('trend.oaAvg')} ${formatPct(average, lang)}`,
    extremes.peak < 0
      ? ''
      : `${t('trend.peak')} ${formatPct(points[extremes.peak].oa_pct as number, lang)}`,
    extremes.dip < 0
      ? ''
      : `${t('trend.dip')} ${formatPct(points[extremes.dip].oa_pct as number, lang)}`,
    overflow.length === 0
      ? ''
      : `${t('trend.offscale', { count: overflow.length })} ${t('trend.ceiling')} ${formatPct(
          domain.max,
          lang,
          0,
        )}`,
  ]
    .filter(Boolean)
    .join('. ');

  /* Peak first, and the low only when it is a different hour - a flat series
     would otherwise ring the same point twice with two contradictory words. */
  const annotations = annotate
    ? [
        { i: extremes.peak, key: 'trend.peak' as const, up: true },
        { i: extremes.dip, key: 'trend.dip' as const, up: false },
      ].filter(({ i }, n) => i >= 0 && (n === 0 || i !== extremes.peak))
    : [];

  if (asTable) {
    return (
      <>
        <div className="trend-toolbar">
          <TableToggle asTable onToggle={() => setAsTable(false)} />
        </div>
        {/* Twenty-four rows will not fit a panel that is also holding a nine-base
            ranking, so the table twin scrolls in place like the ranking does. */}
        <div className="panel__scroll" ref={openAtFoot}>
          <table className="rank-table">
            <thead>
              <tr>
                <th scope="col">{t('trend.time')}</th>
                <th scope="col" className="num">
                  {t('table.oa')}
                </th>
                <th scope="col" className="num">
                  {t('trend.sites')}
                </th>
                {/* Only when the payload carries it: the field is optional on
                    the contract, and an empty column is a question the reader
                    has to answer for themselves. */}
                {anyMachineCount ? (
                  <th scope="col" className="num">
                    {t('trend.machines')}
                  </th>
                ) : null}
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.ts}>
                  {/* The date too once the chart spans days, for the same reason the
                      axis carries it: a column of bare clock times over a week
                      repeats every value seven times. */}
                  <td className="mono">
                    {spansDays ? `${formatDayShort(p.ts, timeZone, lang)} ` : ''}
                    {formatClock(p.ts, timeZone, lang)}
                  </td>
                  <td className="num mono">
                    {p.oa_pct === null ? '-' : formatPct(p.oa_pct, lang)}
                  </td>
                  <td className="num mono">{p.site_count}</td>
                  {anyMachineCount ? (
                    <td className="num mono">{p.machine_count ?? '-'}</td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <div
        className="trend-plot"
        ref={setPlotEl}
        onPointerMove={(e) => setHover(indexAt(e.clientX))}
        onPointerDown={(e) => setHover(indexAt(e.clientX))}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setHover(null)}
      >
        <svg
          className="trend-svg"
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={summary}
        >
          <defs>
            <linearGradient id={fillId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--trend-line)" />
              <stop offset="100%" stopColor="var(--trend-line)" stopOpacity="0" />
            </linearGradient>
            {/*
             * The critical overdraw is clipped, not segmented per hour. Clipping
             * crosses the threshold at the same pixel the line does; splitting
             * the polyline into runs colours whole segments, and would report a
             * 76% hour as critical because its neighbour was 74%.
             */}
            <clipPath id={clipId}>
              <rect
                x={gutter}
                y={warnY}
                width={Math.max(0, W - gutter - PAD_RIGHT)}
                height={Math.max(0, baseline - warnY)}
              />
            </clipPath>
          </defs>

          {/* The gutter probe. Same class and therefore the same font as a real
              tick label, parked outside the viewBox. */}
          <text ref={setProbeEl} className="tnum" x="-999" y="-999" aria-hidden="true">
            100
          </text>

          {/* The grid. Bounds on --line, the tens between them at a third of it:
              enough to read against, quiet enough to ignore. */}
          {gridlines.map((v) => {
            const bound = v === domain.min || v === domain.max;
            return (
              <g key={v}>
                <line
                  x1={gutter}
                  y1={y(v)}
                  x2={W - PAD_RIGHT}
                  y2={y(v)}
                  stroke="var(--line)"
                  strokeWidth="1"
                  opacity={bound ? 1 : 0.35}
                />
                <text x={gutter - 5} y={y(v) + 3} textAnchor="end" fill="var(--sub)" className="tnum">
                  {v}
                </text>
              </g>
            );
          })}

          {/* Six-hourly verticals, so a dip can be placed against a shift. */}
          {xTicks
            .filter((i) => i !== 0 && i !== lastIndex)
            .map((i) => (
              <line
                key={`v${i}`}
                x1={x(i)}
                y1={PAD_TOP}
                x2={x(i)}
                y2={baseline}
                stroke="var(--line)"
                strokeWidth="1"
                opacity="0.35"
              />
            ))}

          {/* Target: dashed because it is a threshold, and labelled at its end
            rather than in a legend swatch - with one series a legend is noise. */}
          <line
            x1={gutter}
            y1={targetY}
            x2={W - PAD_RIGHT}
            y2={targetY}
            stroke="var(--status-warn-mark)"
            strokeWidth="1.5"
            strokeDasharray="5 4"
            opacity="0.8"
          />
          <text x={W - 14} y={targetY - 4} textAnchor="end" fill="var(--status-warn-ink)">
            {t('trend.target', { target })}
          </text>

          <polygon
            points={`${gutter},${baseline} ${line} ${W - PAD_RIGHT},${baseline}`}
            fill={`url(#${fillId})`}
            opacity="0.16"
          />
          <polyline
            points={line}
            fill="none"
            stroke="var(--trend-line)"
            strokeWidth="2.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
          {anyCritical ? (
            <polyline
              points={line}
              fill="none"
              stroke="var(--status-crit-mark)"
              strokeWidth="2.5"
              strokeLinejoin="round"
              strokeLinecap="round"
              clipPath={`url(#${clipId})`}
            />
          ) : null}

          {/*
           * The hours that did not fit under the ceiling.
           *
           * A caret sitting on the rail, one per hour, pointing off the top -
           * the convention every axis-break uses, and the one mark that cannot
           * be read as a value. The legend below carries the count and the
           * highest of them, because "there is more above here" is only half an
           * answer to a reader deciding whether to care.
           */}
          {overflow.map((i) => (
            <polygon
              key={`of${i}`}
              /* In the top margin, clear of the rail - the clamped peak already
                 carries a ring and a label at exactly this x. */
              points={`${x(i) - 4.5},${PAD_TOP - 3} ${x(i)},${PAD_TOP - 10} ${x(i) + 4.5},${PAD_TOP - 3}`}
              fill="var(--trend-line)"
            />
          ))}

          {/*
           * Peak and low, marked and named.
           *
           * The word travels with the figure: "89.1%" alone in the middle of a
           * plot is a number in mid-air, and the two markers are otherwise told
           * apart only by which end of the line they happen to sit on.
           */}
          {annotations.map(({ i, key, up }) => {
            const v = points[i].oa_pct as number;
            const px = x(i);
            const py = yClamped(v);
            /*
             * The label goes on the side the reader expects - above the peak,
             * below the low - and flips when that side has no room. A peak a few
             * points under the target has the dashed threshold directly overhead,
             * and a label printed across it makes two lines illegible instead of
             * one.
             */
            const ceiling = targetY < py - 2 ? Math.max(PAD_TOP, targetY) : PAD_TOP;
            const room = up ? py - ceiling : baseline - py;
            const placeAbove = up ? room >= 22 : room < 22;
            const ly = Math.min(
              Math.max(placeAbove ? py - 10 : py + 16, PAD_TOP + 8),
              baseline - 3,
            );
            return (
              <g key={key}>
                {/* Ringed in the panel colour, so the marker still reads as a
                    marker where it overlaps the line it sits on. */}
                <circle
                  cx={px}
                  cy={py}
                  r="3.5"
                  fill="var(--panel)"
                  stroke={markFor(v)}
                  strokeWidth="2"
                />
                <text x={px} y={ly} textAnchor={anchorFor(px)} fill="var(--ink-2)">
                  {`${t(key)} ${formatPct(v, lang)}`}
                </text>
              </g>
            );
          })}

          {/* Hover: a crosshair and a focused point. The read-out itself is HTML
              below, so it can hold three lines and wrap in Thai. */}
          {hover !== null && hovered ? (
            <g>
              <line
                x1={x(hover)}
                y1={PAD_TOP}
                x2={x(hover)}
                y2={baseline}
                stroke="var(--line-strong)"
                strokeWidth="1"
              />
              {hovered.oa_pct === null ? null : (
                <circle
                  cx={x(hover)}
                  cy={yClamped(hovered.oa_pct)}
                  r="4"
                  fill="var(--panel)"
                  stroke={markFor(hovered.oa_pct)}
                  strokeWidth="2.5"
                />
              )}
            </g>
          ) : null}

          {/* The time axis. Each tick carries a stub past the baseline, so a
              label is tied to a position rather than floating under one. */}
          {xTicks.map((i) => (
            <g key={`t${i}`}>
              <line
                x1={x(i)}
                y1={baseline}
                x2={x(i)}
                y2={baseline + 4}
                stroke="var(--line-strong)"
                strokeWidth="1"
              />
              <text
                x={x(i)}
                y={H - 5}
                textAnchor={i === 0 ? 'start' : i === lastIndex ? 'end' : 'middle'}
                fill="var(--sub)"
              >
                {spansDays
                  ? formatDayShort(points[i].ts, timeZone, lang)
                  : formatClock(points[i].ts, timeZone, lang)}
              </text>
            </g>
          ))}
        </svg>

        {hovered ? (
          <div
            className="trend-tip"
            aria-hidden="true"
            style={{
              left: Math.min(Math.max(x(hover as number), 58), Math.max(58, W - 58)),
              top: Math.max(
                0,
                (hovered.oa_pct === null ? PAD_TOP + 40 : yClamped(hovered.oa_pct)) - 54,
              ),
            }}
          >
            <div className="trend-tip__meta">
              {spansDays ? `${formatDayShort(hovered.ts, timeZone, lang)} ` : ''}
              {formatClock(hovered.ts, timeZone, lang)} · {tz}
            </div>
            <div className="trend-tip__value">
              <b className="tnum">
                {hovered.oa_pct === null ? '-' : formatPct(hovered.oa_pct, lang)}
              </b>
              {hovered.oa_pct === null ? null : (
                <span className="tnum">
                  {formatSigned(hovered.oa_pct - target, lang)} {t('trend.vsTarget')}
                </span>
              )}
            </div>
            <div className="trend-tip__meta">
              {t('trend.sites')} <span className="tnum">{hovered.site_count}</span>
              {/* The hour's denominator, beside the hour's number. An 80% read
                  off one machine and an 80% read off eighteen are the same dot
                  and not the same claim. */}
              {hovered.machine_count === undefined ? null : (
                <>
                  {' · '}
                  {t('trend.machines')}{' '}
                  <span className="tnum">{hovered.machine_count}</span>
                </>
              )}
            </div>
          </div>
        ) : null}
      </div>

      <div className="legend">
        <div className="legend__item">
          <span className="legend__swatch" style={{ background: 'var(--trend-line)' }} />
          {t('kpi.oa.short')}
        </div>
        {/* Named only when an hour actually crosses it: a legend row explaining a
            colour that is not on the chart is a colour the reader hunts for. */}
        {anyCritical ? (
          <div className="legend__item">
            <span className="legend__swatch" style={{ background: 'var(--status-crit-mark)' }} />
            {t('trend.below', { threshold: warnAt })}
          </div>
        ) : null}
        <div className="legend__item">
          <span className="legend__swatch" style={{ background: 'var(--status-warn-mark)' }} />
          {t('trend.target', { target })}
        </div>
        {/* Printed, not hover-only: the 24 h average is the first number an
            executive asks this chart for. */}
        {average === null ? null : (
          <div className="legend__item">
            {t('trend.oaAvg')}
            <b className="tnum">{formatPct(average, lang)}</b>
          </div>
        )}
        {/*
         * The zoom, next to the warning it answers.
         *
         * A reader told "3 h above 120%" has an obvious next question, and the
         * honest answer to it is the rest of the axis rather than a tooltip. It
         * runs from the fitted ceiling to one step past the peak, so the left
         * stop is the chart the panel opens with and the right stop is every
         * reading in view at its own height - and the reader chooses which
         * trade they want rather than having it chosen for them.
         *
         * Native <input type="range">: arrow keys, Home/End and a real
         * accessible name come with it, and none of the three would survive a
         * hand-rolled track and thumb.
         */}
        {zoomable ? (
          <div className="legend__item trend-zoom">
            {/*
             * The warning IS the slider's caption, rather than a legend row of
             * its own beside it. Two items cost this row a wrap - the legend
             * already carries five - and they were saying one thing between
             * them: what is above the ceiling, and how to go and look at it.
             *
             * Once the reader has zoomed past the last off-scale hour there is
             * no warning left to print, so the caption becomes the plain
             * read-out of where they put the ceiling.
             */}
            {/*
             * Both captions occupy the same box (see .trend-zoom__caption), and
             * the ceiling is printed after the slider in either state rather
             * than only in one.
             *
             * That is a layout rule, not a wording preference. The two states
             * used to be different lengths - a warning naming the peak against
             * a two-word label - so dragging the slider changed the width of
             * the legend row, which at board widths tipped it in and out of
             * wrapping. The chart above it then resized by a line on every
             * drag, and the row the reader was aiming at moved under the
             * pointer.
             *
             * The peak is gone from the warning for the same reason, and so is
             * the ceiling read-out that used to follow the slider. Both are
             * already on the picture - the peak as the "Peak" annotation, the
             * ceiling as the top label of the axis the slider moves, which
             * updates live as it is dragged. The legend was spending the widest
             * run of characters in the row repeating two numbers the reader can
             * already see, and paying for it in a wrapped row: at board widths
             * that pushed the axis label and the table toggle onto a second
             * line with a hand's width of nothing between them.
             *
             * Screen readers keep both: `aria-valuetext` on the slider carries
             * the ceiling, and the chart's own summary carries the peak.
             */}
            <span className="trend-zoom__caption">
              {overflow.length > 0 ? (
                <span className="trend-zoom__note">
                  <span className="glyph" aria-hidden="true">
                    <StatusIcon name="alert-triangle" />
                  </span>
                  {t('trend.offscale', { count: overflow.length })}
                </span>
              ) : (
                <label htmlFor={zoomId}>{t('trend.ceiling')}</label>
              )}
            </span>
            <input
              id={zoomId}
              className="trend-zoom__range"
              type="range"
              min={fitted.max}
              max={ceilingMax}
              step={5}
              value={domain.max}
              /* Back at the left stop the ceiling goes to null, not to today's
                 fitted number - so the axis resumes following the data. */
              onChange={(e) => {
                const next = Number(e.target.value);
                setCeiling(next <= fitted.max ? null : next);
              }}
              /* The caption is a warning half the time, so the control carries
                 its own name rather than borrowing whatever is printed beside
                 it, and announces the ceiling as a percentage rather than as a
                 bare slider position. */
              aria-label={t('trend.ceiling')}
              aria-valuetext={formatPct(domain.max, lang, 0)}
            />
          </div>
        ) : null}
        <div className="legend__item">{t('trend.axis', { tz })}</div>
        {coverageChanged ? (
          <div className="legend__item" style={{ color: 'var(--status-warn-ink)' }}>
            <span className="glyph" aria-hidden="true">
              <StatusIcon name="alert-triangle" />
            </span>
            {t('coverage.label', {
              reporting: points[lastIndex].site_count,
              total: coverageMax,
            })}
          </div>
        ) : null}

        {/* Pushed to the right-hand end of the legend row by `margin-left: auto`.
            The panel head is three tabs and the methodology button now, and the
            top-right of the plot belongs to the target label. */}
        <div className="trend-toolbar">
          <TableToggle asTable={false} onToggle={() => setAsTable(true)} />
        </div>
      </div>
    </>
  );
});

/** Every chart has a table twin, so no value is reachable only by hovering. */
function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="chip" onClick={onToggle}>
      {asTable ? t('trend.showChart') : t('trend.showTable')}
    </button>
  );
}
