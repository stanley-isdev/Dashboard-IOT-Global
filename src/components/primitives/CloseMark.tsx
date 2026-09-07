/**
 * The dismiss mark, drawn rather than typed.
 *
 * It was the character `✕`, and the trouble with a character is that it arrives
 * from whichever face the platform resolves it in: on this board it came out
 * lighter than every glyph beside it and optically off centre in its own box,
 * because a dingbat's side bearings are not a UI icon's. Two strokes in the same
 * 16-unit box the status set and the map's zoom controls are drawn in put it back
 * on the board's own weight, and `currentColor` keeps it on the button's.
 *
 * One component because there is one mark. The two modal surfaces here - the base
 * drawer and the methodology dialog - already share a single CSS rule
 * (`.drawer__close`, in components.css); sharing the mark inside it is what stops
 * the pair drifting apart the next time one of them is touched.
 *
 * No accessible name of its own: every caller pairs it with the word in
 * `.visually-hidden`, which is where the translation lives.
 */
export function CloseMark() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
      <path d="M4.2 4.2 11.8 11.8M11.8 4.2 4.2 11.8" />
    </svg>
  );
}
