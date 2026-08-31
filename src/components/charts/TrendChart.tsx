import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { TrendPoint } from '../../api/contract';
import { useI18n } from '../../i18n/I18nProvider';
import { formatClock, formatPct, formatSigned, zoneAbbrev, zoneHour } from '../../i18n/format';
import { extremesOf, timeTickIndices, trendDomain, yTicks } from './trendScale';

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
  referenceTimezone: string;
}

export function TrendChart({ points, target, warnAt, referenceTimezone }: Props) {
  const { t, lang } = useI18n();
  const [asTable, setAsTable] = useState(false);

  /* Which hour the pointer is over. Null is the resting state, not hour zero. */
  const [hover, setHover] = useState<number | null>(null);

  /* Two charts can be mounted at once (overview and company detail), and a
     duplicated gradient id would have them share one fill and one clip. */
  const uid = useId();
  const fillId = `trend-fill-${uid}`;
  const clipId = `trend-below-${uid}`;

  /*
   * The viewBox tracks the element's real pixel box rather than being fixed at
   * 600x150 and stretched to fit. It used to be the latter, which was harmless
   * while the panel was a fixed 150px tall - now that the chart fills whatever
   * the board has spare, a fixed viewBox with preserveAspectRatio="none" scales
   * the y-axis by 4x and drags every label and stroke out of shape with it.
   * One unit here is one pixel, so type and line weights stay true at any size.
   */
  const plotRef = useRef<HTMLDivElement>(null);
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
  const probeRef = useRef<SVGTextElement>(null);
  const [gutter, setGutter] = useState(PAD_X_MIN);

  useEffect(() => {
    const el = probeRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(([entry]) => {
      const next = Math.max(PAD_X_MIN, Math.ceil(entry.contentRect.width) + 10);
      setGutter((prev) => (prev === next ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

  useEffect(() => {
    const el = plotRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([entry]) => {
      const box = entry.contentRect;
      const next = {
        w: Math.max(240, Math.round(box.width)),
        h: Math.max(90, Math.round(box.height)),
      };
      // Guard the update, or a rounding wobble becomes a render loop.
      setSize((prev) => (prev.w === next.w && prev.h === next.h ? prev : next));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [asTable]);

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
  const domain = useMemo(
    () => trendDomain(usable.map((p) => p.oa_pct as number), target),
    [usable, target],
  );

  const gridlines = useMemo(() => yTicks(domain), [domain]);

  /* Resolving the zone hour is the component's job - it is the one part that
     needs Intl and the deploy-time reference zone. */
  const xTicks = useMemo(
    () => timeTickIndices(points.map((p) => zoneHour(p.ts, referenceTimezone))),
    [points, referenceTimezone],
  );

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

  const line = points
    .map((p, i) => (p.oa_pct === null ? null : `${x(i)},${y(p.oa_pct)}`))
    .filter(Boolean)
    .join(' ');

  const targetY = y(clampToDomain(target));
  const warnY = y(clampToDomain(warnAt));
  const baseline = H - PAD_BOTTOM;
  const lastIndex = points.length - 1;
  const tz = zoneAbbrev(points[0].ts, referenceTimezone);
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
    const el = plotRef.current;
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
        <div className="panel__scroll">
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
                  <td className="mono">{formatClock(p.ts, referenceTimezone, lang)}</td>
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
        ref={plotRef}
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
          <text ref={probeRef} className="tnum" x="-999" y="-999" aria-hidden="true">
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
           * Peak and low, marked and named.
           *
           * The word travels with the figure: "89.1%" alone in the middle of a
           * plot is a number in mid-air, and the two markers are otherwise told
           * apart only by which end of the line they happen to sit on.
           */}
          {annotations.map(({ i, key, up }) => {
            const v = points[i].oa_pct as number;
            const px = x(i);
            const py = y(v);
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
                  cy={y(hovered.oa_pct)}
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
                {formatClock(points[i].ts, referenceTimezone, lang)}
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
              top: Math.max(0, (hovered.oa_pct === null ? PAD_TOP + 40 : y(hovered.oa_pct)) - 54),
            }}
          >
            <div className="trend-tip__meta">
              {formatClock(hovered.ts, referenceTimezone, lang)} · {tz}
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
        <div className="legend__item">{t('trend.axis', { tz })}</div>
        {coverageChanged ? (
          <div className="legend__item" style={{ color: 'var(--status-warn-ink)' }}>
            <span className="glyph" aria-hidden="true">
              ▲
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
}

/** Every chart has a table twin, so no value is reachable only by hovering. */
function TableToggle({ asTable, onToggle }: { asTable: boolean; onToggle: () => void }) {
  const { t } = useI18n();
  return (
    <button type="button" className="chip" onClick={onToggle}>
      {asTable ? t('trend.showChart') : t('trend.showTable')}
    </button>
  );
}
