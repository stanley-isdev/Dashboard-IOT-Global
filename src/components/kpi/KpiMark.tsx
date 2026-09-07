/**
 * The orange subject marks, one per card of the executive strip.
 *
 * Deliberately not part of StatusIcon. That set is a set of *silhouettes* whose
 * whole job is to survive greyscale and three metres, because on this palette
 * red and amber are indistinguishable to a deuteranope and shape has to carry
 * the meaning (see src/domain/status.ts). These carry no meaning at all - they
 * are subject marks, "this card is about machines", "this card is about the ones
 * that are running" - so they are drawn as pictures, in the brand orange, and
 * nothing on the board is decided by them.
 *
 * That claim is thinner on some of them than on others, and it is worth saying
 * where. `bell` sits on NEEDING ATTENTION and `stop` is the power symbol, and
 * both shapes mean something in their own right - a reader can take the bell for
 * an alarm state rather than for the card's subject. The defence is that the mark
 * never changes: the bell is drawn identically at zero sites and at four, so it
 * cannot be read as a state that came and went. Every signal on this strip is
 * still carried by tone, figure and foot. If that stops holding, the fix is to
 * drop the mark from those cards, not to recolour it - a mark that changes
 * colour is a status icon, and this set is explicitly not that.
 *
 * The same rule is why none of these borrows a shape from StatusIcon. `stop` is
 * a power symbol and not the octagon that set draws for critical, precisely
 * because the octagon is spoken for: a status glyph used as decoration is how a
 * reader learns to stop trusting the real ones.
 *
 * Drawn rather than typed, for the reason StatusIcon.tsx already records: ⚙ and
 * ▶ are a colour-font lottery. The emoji presentation of U+2699 is grey on every
 * platform that has one, so it cannot be the orange the redraw asks for; and at
 * 13px a fallback glyph lands as a smudge.
 *
 * Every shape here was rendered at 13px and picked on what survived, which is
 * the only test that matters for a 13px mark. Several failed their first draft:
 * a stroked octagon for STOP became a circle and a filled one became a dot, a
 * filled gauge swallowed its own needle, and a three-ring target closed up into
 * a spiral. The shapes below are the drafts that read.
 *
 * That test outranked an earlier rule - alternate stroked and solid, because two
 * outlines side by side read as one texture - and the row now runs stroke,
 * solid, stroke, stroke, stroke, solid rather than strictly alternating. What
 * keeps the neighbours apart instead is silhouette: RUNNING's filled disc
 * against STOP's open ring is the sharpest contrast in the row and it is the
 * pair that most needs one, and the gauge is a half-circle against the target's
 * full one. Nowhere in the row do two marks of the same weight *and* the same
 * outline meet.
 *
 * Sized in `em` like the rest of the icon work here, so it tracks the label it
 * sits beside and the kiosk density switch - which moves the font tokens, not
 * the root size - carries it along without a second rule.
 */

export type KpiMarkName = 'gear' | 'play' | 'stop' | 'gauge' | 'target' | 'bell';

/** The 24-unit box both marks below are drawn in. */
const BOX = '0 0 24 24';

/**
 * The cog, stroked. A ring of eight rounded lobes around a hollow centre - the
 * outline reads as a gear at 13px where a solid one reads as a blob, and the
 * hollow middle is what separates it from the solid disc beside it at a glance.
 */
function Gear() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3.1" />
      <path
        d="M19.2 14.9a1.6 1.6 0 0 0 .32 1.77l.06.06a1.94 1.94 0 1 1-2.75 2.75l-.06-.06a1.6 1.6 0 0 0-1.77-.32 1.6 1.6 0 0 0-.97 1.47v.17a1.94 1.94 0 1 1-3.88 0v-.09a1.6 1.6 0 0 0-1.03-1.46 1.6 1.6 0 0 0-1.77.32l-.06.06a1.94 1.94 0 1 1-2.75-2.75l.06-.06a1.6 1.6 0 0 0 .32-1.77 1.6 1.6 0 0 0-1.47-.97H3.2a1.94 1.94 0 1 1 0-3.88h.09a1.6 1.6 0 0 0 1.46-1.03 1.6 1.6 0 0 0-.32-1.77l-.06-.06a1.94 1.94 0 1 1 2.75-2.75l.06.06a1.6 1.6 0 0 0 1.77.32h.08a1.6 1.6 0 0 0 .97-1.47V3.2a1.94 1.94 0 1 1 3.88 0v.09a1.6 1.6 0 0 0 .97 1.47 1.6 1.6 0 0 0 1.77-.32l.06-.06a1.94 1.94 0 1 1 2.75 2.75l-.06.06a1.6 1.6 0 0 0-.32 1.77v.08a1.6 1.6 0 0 0 1.47.97h.17a1.94 1.94 0 1 1 0 3.88h-.09a1.6 1.6 0 0 0-1.46.97Z"
      />
    </g>
  );
}

/**
 * Play: a solid disc with the triangle cut out of it.
 *
 * This replaces a briefcase, and the reason is the mark two cards along. Once
 * STOP became the power symbol, RUNNING and STOP were a transport pair with only
 * one half drawn - play against power is a control anybody has operated, and it
 * says "these two figures are the two halves of one total" without a word. A
 * briefcase said "work", which is true of the card and true of every other card
 * on the strip.
 *
 * Solid where its partner is stroked, and that asymmetry is deliberate: the two
 * marks have to be told apart at a glance across 400px of strip, and a stroked
 * play triangle in a stroked ring is the same amount of ink as the power symbol
 * in the same outline. Filled against outlined separates them before either
 * shape is read - which is the same argument StatusIcon.tsx makes about
 * silhouette carrying meaning ahead of detail.
 *
 * ## Why the triangle is a hole and not a white shape
 *
 * One path, two subpaths, `fill-rule: evenodd` - so the triangle is a genuine
 * hole and whatever is behind the mark shows through it. Drawing it as a white
 * triangle laid over the disc would be correct on the light theme and a white
 * scar on the dark one, where the card is #101a2c. The hole costs nothing and
 * is right on both.
 *
 * The triangle's points put its centroid at x=12.0, dead centre of the box. A
 * play triangle set on its geometric centre reads as leaning left, because the
 * eye weights the mass and not the bounding box.
 */
function Play() {
  return (
    <path
      fill="currentColor"
      fillRule="evenodd"
      clipRule="evenodd"
      d="M12 2.9a9.1 9.1 0 1 0 0 18.2 9.1 9.1 0 0 0 0-18.2Zm-2.1 5.15L16.2 12l-6.3 3.95Z"
    />
  );
}

/**
 * The power symbol, stroked: a broken ring with a bar rising out of the gap.
 *
 * Two shapes were tried and rejected before this one, and both failures are the
 * same failure. The stop-sign octagon does not survive this size - rendered at
 * 13, 16 and 20px it reads as a circle at every one of them, because eight
 * 7-unit flats are below the threshold at which a corner can hold, and filling
 * it only turns it into a dot. The plain rounded square that replaced it does
 * survive, but it survives as a *blob*: a square with nothing inside it is the
 * only mark in this set that is not a picture of anything, and beside a gear, a
 * briefcase, a gauge, a target and a bell it reads as the one the artist had not
 * drawn yet.
 *
 * The power symbol solves both at once. The gap in the ring and the bar through
 * it are two features rather than one silhouette, so the shape is still legible
 * at 13px where a solid outline is not - and it is a picture of something. It is
 * also the honest content of this card: what is counted here is every machine
 * that is not producing, whatever the status underneath says, and "off" is the
 * one word that covers all of them.
 *
 * Deliberately *not* the octagon that StatusIcon draws for critical and stopped.
 * That set means something - a mark from it beside a figure is a claim about
 * that figure's state - and this file's whole premise is that these six marks
 * mean nothing and decide nothing. Borrowing the octagon here would put a status
 * glyph on a card as decoration, which is how a reader learns to stop trusting
 * the real ones.
 *
 * The 2.2 stroke matches Gauge below, which is the other stroked mark of this
 * weight; the gap is centred on the bar so the mark stays symmetrical about its
 * own vertical axis and does not lean beside the label.
 */
function Stop() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M6.4 6.4a7.9 7.9 0 1 0 11.2 0" />
      <path d="M12 2.7v7.5" />
    </g>
  );
}

/**
 * The dial, stroked: a 180-degree arc and a needle, and nothing else.
 *
 * The first draft filled the band and put a tapered needle inside it, and the
 * needle disappeared - a filled arc 3.8 units thick leaves a hole 10.8 across,
 * and a needle long enough to read runs into the band and fuses with it. Two
 * strokes have no inside to be swallowed by.
 *
 * The needle points up and to the right because a needle pointing straight up
 * reads as a hub with a stalk; the shape only becomes a gauge once the needle is
 * somewhere a gauge's needle can actually be. That it is also where this card's
 * figure sits when the fleet is healthy costs nothing and is quietly apt.
 */
function Gauge() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
      <path d="M3.6 16.2a8.4 8.4 0 0 1 16.8 0" />
      <path d="M12 16.2 16.1 11.4" />
    </g>
  );
}

/**
 * The target, stroked - two rings and a filled bullseye.
 *
 * The centre is solid because a third thin ring inside two thin rings is a moiré
 * at this size; a dot is what tells the reader where the middle is. It is also
 * fatter than the first draft's, which measured 1 unit and vanished at 13px,
 * leaving two bare rings that read as a spiral rather than as a target.
 *
 * Two rings and not one, for the opposite reason: a single ring with a dot in it
 * is a radio button, and this card is about hitting a number.
 */
function Target() {
  return (
    <g fill="none" stroke="currentColor" strokeWidth="2">
      <circle cx="12" cy="12" r="8.7" />
      <circle cx="12" cy="12" r="4.7" />
      <circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none" />
    </g>
  );
}

/**
 * The bell, solid: body and clapper as two pieces, with the hairline between
 * them doing the same job the briefcase's clasp gap does. Solid rather than
 * stroked so it counterweights the target above it in the row.
 */
function Bell() {
  return (
    <g fill="currentColor" stroke="none">
      {/* Body, from the crown down to the flared rim. */}
      <path d="M12 2.4a1.55 1.55 0 0 1 1.55 1.55v.42a6.75 6.75 0 0 1 5.2 6.57v2.92l1.42 2.46a1 1 0 0 1-.87 1.5H4.7a1 1 0 0 1-.87-1.5l1.42-2.46v-2.92a6.75 6.75 0 0 1 5.2-6.57v-.42A1.55 1.55 0 0 1 12 2.4Z" />
      {/* Clapper. */}
      <path d="M9.55 19.05h4.9a2.45 2.45 0 0 1-4.9 0Z" />
    </g>
  );
}

const MARKS: Record<KpiMarkName, () => React.ReactElement> = {
  gear: Gear,
  play: Play,
  stop: Stop,
  gauge: Gauge,
  target: Target,
  bell: Bell,
};

/**
 * One subject mark. Always `aria-hidden`: the label it sits beside is the thing
 * being read, and "gear, Total machine" is one word of noise per card.
 */
export function KpiMark({ name, size = '1.2em' }: { name: KpiMarkName; size?: string }) {
  const Shape = MARKS[name];
  return (
    <svg
      className="kpi__mark"
      viewBox={BOX}
      width={size}
      height={size}
      aria-hidden="true"
      focusable="false"
    >
      <Shape />
    </svg>
  );
}
