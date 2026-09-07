import type { ReactNode } from 'react';
import { StateGlyph, type StateGlyphName } from './StateGlyph';

/**
 * The board with no numbers on it.
 *
 * One layout for every state where nothing has loaded - still loading, cannot
 * reach the API, cannot reach the database, timed out, malformed payload,
 * filtered to nothing, no such site, not signed in, retrying. Nine states, one
 * component, because they differ only in which mark, which sentence and which
 * three things to go and check.
 *
 * ## Why it is not a card
 *
 * It was, in the first pass: a bordered panel with a shadow, centred in the
 * region. That is what every other block on this board is, and that is exactly
 * why it was wrong here - a card says "this is one object among several", and
 * on this screen it is the only object there is. Chrome's own offline page is
 * the reference: an empty ground, one column of type on it, no container at
 * all. Nothing to draw a box around means nothing for the eye to skip past.
 *
 * The column is left-aligned and sits about a third of the way down rather than
 * dead centre, for the same reason Chrome's does: centred type has no left edge
 * to run a list against, and vertical centring puts the first line of it below
 * where the eye lands.
 *
 * ## The order of the six parts
 *
 *   glyph    which thing is wrong, before anything is read (StateGlyph.tsx)
 *   title    the same thing in words, at reading weight, not display weight
 *   body     one or two lines: what broke, what still works, for how long
 *   checks   the three things to go and look at - the part the old panel lacked
 *   actions  the one or two things that can be done from here
 *   code     the machine's own words, last and quietest
 *
 * The heading is 500, not 600, and it is not large. The alarm on this screen is
 * carried by the Offline badge in the masthead - which is the one place on this
 * board a colour is allowed to shout - and by the board being empty. A second
 * alarm in the heading would be the third, and an error page that shouts is one
 * people stop reading.
 *
 * `code` is the line somebody photographs and sends to IT, which is why it
 * carries the endpoint, the status and the clock time on one line and why it is
 * the only monospace on the page. It is last and at --fs-nano because it is the
 * one part of this page an executive never needs.
 */

/**
 * Which ink the mark takes.
 *
 * `neutral` is not a lesser `crit` - it is the tone for the states that are not
 * faults at all: still loading, filtered to nothing, no such site. Painting
 * those red would be the same lie as showing a 0, in the other direction. See
 * the note on the funnel in StateGlyph.tsx.
 */
export type StateTone = 'neutral' | 'warn' | 'crit' | 'other';

export interface StatePageProps {
  tone: StateTone;
  glyph: StateGlyphName;
  title: string;
  body?: ReactNode;
  /** The "try this" list. Rendered with its heading only when non-empty. */
  checks?: readonly ReactNode[];
  /** Localised heading for `checks`. Required when `checks` is non-empty. */
  checksLabel?: string;
  /** Endpoint, status and time, on one line. Upper-cased by the stylesheet. */
  code?: string;
  /**
   * Renders `code` as a wrapping block instead of one scrolling line, and
   * leaves its case alone. Only `contract` needs it: there the detail is the
   * server's own multi-line complaint about a field, and upper-casing a JSON
   * path would destroy the one string on the page a developer needs verbatim.
   */
  codeMultiline?: boolean;
  /** The one or two buttons that belong in the text column. */
  actions?: ReactNode;
  /**
   * The corner button, where Chrome keeps Reload - away from the text and in
   * the corner this board's refresh control already occupies when it is
   * healthy, so a returning reader finds it where they left it.
   */
  reload?: { label: string; onClick: () => void };
  /** Shows the indeterminate track. For the states that are genuinely working. */
  busy?: boolean;
  /**
   * `alert` interrupts a screen reader, `status` waits for a pause. A failure
   * is the first; still loading is the second, or every poll on a wall panel
   * would announce itself.
   */
  live?: 'alert' | 'status';
}

export function StatePage({
  tone,
  glyph,
  title,
  body,
  checks,
  checksLabel,
  code,
  codeMultiline = false,
  actions,
  reload,
  busy = false,
  live = 'alert',
}: StatePageProps) {
  return (
    <div className={`statepage statepage--${tone}`} role={live} aria-busy={busy || undefined}>
      {reload ? (
        <button type="button" className="statepage__reload chip tap" onClick={reload.onClick}>
          {reload.label}
        </button>
      ) : null}

      <div className="statepage__column">
        <StateGlyph name={glyph} />

        <h2 className="statepage__title">{title}</h2>

        {body ? <p className="statepage__body">{body}</p> : null}

        {checks && checks.length > 0 ? (
          <div className="statepage__try">
            <span className="statepage__try-label">{checksLabel}</span>
            <ul>
              {checks.map((check, i) => (
                // Index keys: this list is rebuilt whole whenever the state
                // changes and is never reordered or spliced.
                <li key={i}>{check}</li>
              ))}
            </ul>
          </div>
        ) : null}

        {/*
         * The track sits under the actions rather than beside the glyph,
         * because it is the last thing that changes and the eye should not be
         * pulled back up to the top of the column by it. Indeterminate: this
         * end knows a request is in flight and nothing more, and a bar that
         * claims 46% of a query it cannot measure is the same invention as a
         * fabricated figure. See .statepage__track for the reduced-motion case.
         */}
        {busy ? (
          <div className="statepage__track" aria-hidden="true">
            <i />
          </div>
        ) : null}

        {actions ? <div className="statepage__actions">{actions}</div> : null}

        {code ? (
          <pre className={`statepage__code${codeMultiline ? ' statepage__code--block' : ''}`}>
            {code}
          </pre>
        ) : null}
      </div>
    </div>
  );
}
