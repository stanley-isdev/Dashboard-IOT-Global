import type { StatusIconName } from '../../domain/status';

/**
 * The status icon set: one outlined mark per status, drawn rather than typed.
 *
 * These were single characters - ▲ ● ■ ⊘ ◐ - chosen because a geometric shape
 * survives greyscale and distance in a way a hue does not. That reasoning has
 * not changed and is why this is still a set of *silhouettes* rather than a set
 * of pictures: a triangle, an octagon, a ring, a ring with a bar through it. What
 * changed is that a typographic shape is at the mercy of the font. ▲ and ■ are
 * drawn at different optical weights in every face, ⊘ is missing from several
 * Thai fallbacks, and none of them can carry the exclamation mark that makes
 * "warning" read as a warning rather than as a bullet that happens to be
 * pointy.
 *
 * ## Why they still work at three metres
 *
 * The accessibility argument in domain/status.ts is unchanged: on this palette
 * red and amber sit at a deuteranope colour distance of roughly 2-6 against a
 * usable floor of 6-8, so shape has to carry the meaning. Each icon below is
 * distinguishable by outline alone at 11px - the containers differ (triangle,
 * octagon, circle) before the contents do.
 *
 * The stroke is deliberately heavier than an icon font's: 1.8 in a 16-unit box,
 * against the 1.2-1.5 a UI icon usually gets. An outlined mark is thinner than
 * the solid character it replaces, and this board is read across a factory
 * corridor. `vector-effect: non-scaling-stroke` is *not* used, for the same
 * reason - the stroke has to grow with the icon when the kiosk switch doubles
 * every font size.
 *
 * ## Sizing
 *
 * `1.05em` square, so the icon scales with whatever text it sits beside and the
 * kiosk density switch - which changes the font tokens, not the root font size -
 * carries it along for free. A rem or a px here would hold still while the
 * numbers beside it doubled.
 */

/** The 16-unit box every path below is drawn in. */
const BOX = '0 0 16 16';

/** A filled dot, for the exclamation and ellipsis marks. */
function Dot({ cx, cy }: { cx: number; cy: number }) {
  return <circle cx={cx} cy={cy} r="0.85" fill="currentColor" stroke="none" />;
}

/** The ring shared by most of the set, as a path so the dash pattern can vary. */
const RING = 'M14.1 8A6.1 6.1 0 1 1 1.9 8a6.1 6.1 0 0 1 12.2 0Z';

const SHAPES: Record<StatusIconName, React.ReactNode> = {
  /* On target, running. A tick inside a ring - the one mark in the set that is
     read as "fine" without being read at all. */
  'check-circle': (
    <>
      <path d={RING} />
      <path d="M5.4 8.2 7.2 10 10.7 6.2" />
    </>
  ),

  /* Below target. The exclamation triangle, which is the one shape in this set
     that already means "warning" to everybody before they read the label. */
  'alert-triangle': (
    <>
      <path d="M8 2.3 1.95 13a.85.85 0 0 0 .74 1.28h10.62A.85.85 0 0 0 14.05 13L8 2.3Z" />
      <path d="M8 6.6v2.9" />
      <Dot cx={8} cy={11.9} />
    </>
  ),

  /* Critical, stopped. An octagon and not a bigger triangle: at 11px a triangle
     and a "more urgent triangle" are the same shape, and this has to be
     separable from `alert-triangle` at a glance. It is also the stop-sign
     outline, which needs no explaining. */
  'alert-octagon': (
    <>
      <path d="M5.55 1.85h4.9l3.7 3.7v4.9l-3.7 3.7h-4.9l-3.7-3.7v-4.9l3.7-3.7Z" />
      <path d="M8 5.3v3.3" />
      <Dot cx={8} cy={11.1} />
    </>
  ),

  /* Stale: it did report, and the figure on screen is the last one it sent. A
     clock rather than a warning, because the number is real and only its age is
     the problem. */
  clock: (
    <>
      <path d={RING} />
      <path d="M8 4.7V8l2.4 1.5" />
    </>
  ),

  /* No data in the window - connected, nothing to report. An empty dashed ring:
     the outline of a value that is not there. */
  'circle-dashed': <path d={RING} strokeDasharray="2.3 2.2" />,

  /* No gateway commissioned. The barred ring, which is what ⊘ was, and the one
     mark that must never be confused with `circle-dashed` - "we are not
     measuring this site yet" and "this site reported nothing" are the two
     meanings section 11 exists to keep apart. */
  'circle-slash': (
    <>
      <path d={RING} />
      <path d="M4 12 12 4" />
    </>
  ),

  /* Idle - No Plan, Order End. Paused, not stopped. */
  'pause-circle': (
    <>
      <path d={RING} />
      <path d="M6.6 5.9v4.2M9.4 5.9v4.2" />
    </>
  ),

  /* The `other` bucket, which is 4M Change while D-21 is open. An ellipsis,
     because the honest content of this bucket is "a status we have not decided
     where to put yet". */
  'circle-ellipsis': (
    <>
      <path d={RING} />
      <Dot cx={5.3} cy={8} />
      <Dot cx={8} cy={8} />
      <Dot cx={10.7} cy={8} />
    </>
  ),

  /* Informational alerts. */
  'info-circle': (
    <>
      <path d={RING} />
      <Dot cx={8} cy={5.1} />
      <path d="M8 7.6v3.3" />
    </>
  ),

  /* A minor alert: the same exclamation as the triangle, in the calmest
     container in the set. */
  'alert-circle': (
    <>
      <path d={RING} />
      <path d="M8 5.3v3.3" />
      <Dot cx={8} cy={11.1} />
    </>
  ),

  /* Genuinely inapplicable - achievement against a zero plan. A bare dash, and
     no container: there is no state here to draw a badge around. */
  minus: <path d="M4.3 8h7.4" />,
};

/**
 * One status icon. Always `aria-hidden` - the word beside it carries the meaning
 * for a screen reader, and StatusGlyph is what puts it there.
 */
export function StatusIcon({
  name,
  size = '1.05em',
}: {
  name: StatusIconName | null;
  size?: string;
}) {
  // Null is the `value` measure kind - a figure that is simply present and needs
  // no mark. Handled here so no caller has to assert its token has one.
  if (!name) return null;

  return (
    <svg
      className="status-icon"
      viewBox={BOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
