/**
 * The eight marks a state page can lead with.
 *
 * A second icon set, deliberately, and the split is by size rather than by
 * subject. StatusIcon's marks are drawn in a 16-unit box at 1.8 stroke because
 * they sit inline beside 11px type and have to survive being read across a
 * corridor at that size. These are drawn in a 64-unit box at 2 stroke because
 * they sit alone above a heading at forty-odd pixels, and StatusIcon's marks
 * scaled up to that size read as clip art: a 1.8/16 stroke is 11% of the box,
 * which at 44px is a 5px slab.
 *
 * ## Why these shapes and not warning triangles
 *
 * A state page has already said "something is wrong" three other ways - the
 * Offline badge in the masthead, the heading, and the fact that the board is
 * empty. What the mark is for at that point is saying *which* thing is wrong,
 * before the heading is read. So each one is an object out of this board's own
 * world - the database it reads, the chain to the API, the funnel the filters
 * are, the pin a site is - and never a generic alarm, because eight generic
 * alarms carry no information at all.
 *
 * There is deliberately no "retrying" mark. That state is a line of text under
 * a page that holds still - see RetryLine in HardErrorState.tsx for why a
 * swapping page was worse than a swapping sentence.
 *
 * That is the opposite of the rule for the banners in ConnectionBanner, where
 * the data is still on screen and the icon's whole job IS to say "warning".
 * Those use StatusIcon's standard set.
 *
 * ## Accessibility
 *
 * Always `aria-hidden`. Every one of these sits directly above a heading that
 * says the same thing in words, and none of them is the only carrier of
 * anything - which is the same contract StatusIcon has, for the same reason
 * domain/status.ts gives: on this palette a hue cannot be relied on, so the
 * shape is a second channel for a sighted reader and the text is the first
 * channel for everybody.
 */

export type StateGlyphName =
  | 'database'
  | 'database-slash'
  | 'chain-broken'
  | 'clock'
  | 'braces'
  | 'funnel'
  | 'map-pin'
  | 'lock';

/** The 64-unit box every path below is drawn in. */
const BOX = '0 0 64 64';

/* The cylinder, shared by the two database marks: a top ellipse and two
   stacked barrel walls. Two walls rather than three, because at 44px a
   three-band cylinder closes up into a striped blob. */
const CYLINDER = (
  <>
    <ellipse cx="32" cy="14" rx="20" ry="7.5" />
    <path d="M12 14v15c0 4.1 9 7.5 20 7.5s20-3.4 20-7.5V14" />
    <path d="M12 29v15c0 4.1 9 7.5 20 7.5s20-3.4 20-7.5V29" />
  </>
);

const SHAPES: Record<StateGlyphName, React.ReactNode> = {
  /* Reading the database. The plain cylinder, which is what the board is
     waiting on - not a spinner, which says only "waiting" and could be
     waiting on anything. */
  database: CYLINDER,

  /* The database is unreachable. The same cylinder with a bar through it,
     which is the `circle-slash` convention from StatusIcon applied to a
     different container: the mark for "this thing exists and we cannot get at
     it", as distinct from "this thing reported nothing". */
  'database-slash': (
    <>
      {CYLINDER}
      <path d="M10 55 54 9" />
    </>
  ),

  /* The API itself cannot be reached. A broken chain link - two arcs with a
     gap, and a stub on each side of the gap so it reads as *broken* rather
     than as two unrelated brackets. Separable from `database-slash` at a
     glance because nothing in it is a cylinder. */
  'chain-broken': (
    <>
      <path d="M27 19h-7a13 13 0 0 0 0 26h7" />
      <path d="M37 19h7a13 13 0 0 1 0 26h-7" />
      <path d="M22 32h5M37 32h5" />
    </>
  ),

  /* Out of time. The same clock as StatusIcon's, redrawn at this scale rather
     than scaled: the hands are a real proportion of the face here, where a
     16-unit clock blown up to 44px has hands as thick as its rim. */
  clock: (
    <>
      <circle cx="32" cy="32" r="20" />
      <path d="M32 18v14l10 7" />
    </>
  ),

  /* The payload does not match the contract. A brace pair with a cross between
     them: braces because the fault is in the shape of the JSON and nowhere
     else, and the cross because a brace pair on its own reads as "code" rather
     than as "code that is wrong". */
  braces: (
    <>
      <path d="M25 13c-6 0-8 3-8 8v4c0 3-2 5-4 5 2 0 4 2 4 5v4c0 5 2 8 8 8" />
      <path d="M39 13c6 0 8 3 8 8v4c0 3 2 5 4 5-2 0-4 2-4 5v4c0 5-2 8-8 8" />
      <path d="M28 28l8 8M36 28l-8 8" />
    </>
  ),

  /* The filters matched nothing. A funnel, which is the one mark in this set
     that must not read as a fault: the query succeeded and the board is empty
     because of a choice the reader made. It is drawn in the neutral ink for
     that reason - see StatePage's tone table. */
  funnel: <path d="M12 15h40L37 34v17l-10-6V34z" />,

  /* The site in the URL does not exist. A map pin with a question mark inside
     it, drawn as strokes rather than set as type: a `?` in a <text> element
     would be drawn by whichever font resolved, at whichever weight, which is
     the exact failure StatusIcon's header describes. */
  'map-pin': (
    <>
      <path d="M32 53s15-14 15-24a15 15 0 1 0-30 0c0 10 15 24 15 24z" />
      <path d="M27 24.5a5.2 5.2 0 0 1 8.4 4.1c0 3.1-3.4 3.4-3.4 6.4" />
      <circle cx="32" cy="39.4" r="1.1" fill="currentColor" stroke="none" />
    </>
  ),

  /* Not signed in. A padlock, which needs no explaining in any locale and is
     the one mark here that describes a door rather than a fault. */
  lock: (
    <>
      <rect x="15" y="29" width="34" height="23" rx="4" />
      <path d="M23 29v-6a9 9 0 0 1 18 0v6" />
      <path d="M32 38v6" />
    </>
  ),
};

export function StateGlyph({ name, size = '3rem' }: { name: StateGlyphName; size?: string }) {
  return (
    <svg
      className="statepage__glyph"
      viewBox={BOX}
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      /*
       * 3 in a 64-unit box, which is 2.25px at the 48px default.
       *
       * This started at 2 and rendered as a wisp. The header above warns that
       * StatusIcon's 1.8/16 - 11% of its box - would be a slab at this size,
       * and that is true, but 2/64 is 3% and overshot the other way: measured
       * on the board it drew at 1.4px, thinner than the 1px hairlines around
       * the panels, so the mark read as a scratch rather than as an object.
       * ~4.7% is the weight that holds at arm's length without going bold.
       */
      strokeWidth="3"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {SHAPES[name]}
    </svg>
  );
}
