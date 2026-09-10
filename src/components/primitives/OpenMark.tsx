/**
 * The drill-down mark: an arrow pointing up and to the right, drawn rather than
 * typed.
 *
 * It was the character `↗`, and a character arrives from whichever face the
 * platform resolves it in - on this board it came out lighter than the row it
 * sits in and optically off centre in its own box, because an arrow dingbat's
 * side bearings are not a UI icon's. One stroke and a head in the same 16-unit
 * box the status set, the map's zoom controls and `CloseMark` are drawn in put
 * it on the board's own weight, and `currentColor` keeps it on the link's.
 *
 * Up-RIGHT, at 45 degrees, which is the direction this mark has always pointed
 * and the one the web has settled on for "opens somewhere else". Straight up
 * was tried and put back: the same row already carries the sort control's
 * ascending chevron a few columns to the left, and two upward marks meaning two
 * different things across one header is a reading the eye has to be taught. The
 * head is a corner rather than a chevron, built on the shaft's own 45 degrees,
 * and the rounded cap and join keep it in the same family as the dismiss mark
 * instead of reading as a glyph borrowed from elsewhere.
 *
 * No accessible name of its own: `GrafanaLink` pairs it with the word in
 * `.visually-hidden`, which is where the translation lives.
 */
export function OpenMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4.6 11.4 11.4 4.6M6.2 4.6h5.2v5.2" />
    </svg>
  );
}
