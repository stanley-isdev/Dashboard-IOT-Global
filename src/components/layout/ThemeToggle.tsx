import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';

/**
 * The light/dark switch: one round button in the masthead, beside the language
 * tiles.
 *
 * ## Why an icon rather than a tile pair
 *
 * The language control next to this one deliberately shows *both* codes with the
 * active one filled, because a lone button labelled "TH" is indistinguishable
 * from a label until you press it. A theme switch is not in that position: sun
 * and moon are a two-state pair everyone already reads as a switch, and - unlike
 * "TH" - an icon-only control has an accessible name with room to say what
 * pressing it does. So this one draws the *destination* (a moon while the board
 * is light) and puts "Switch to dark theme" in both `aria-label` and `title`,
 * which is what a screen reader announces and what a hovering mouse gets.
 *
 * `aria-pressed` is *not* set. "Pressed" would have to mean either "the board is
 * dark" or "the board is light", and there is no way for the reader to tell
 * which, on top of a name that already states the action - a toggle button whose
 * name changes with its state is the pattern that avoids the ambiguity.
 *
 * ## Sizing
 *
 * A 2rem circle, which is the height of the freshness pill and the language
 * track it follows. `.tap` grows the *hit* area to 44px without changing
 * the drawn size, because this sits in the top corner of an iPad in a stand and
 * a 32px target there is a two-attempt tap.
 *
 * The icons are drawn in the same 16-unit box and at the same 1.8 stroke as
 * StatusIcon, so the two sets sit at the same optical weight when both are on
 * screen - see the long note in primitives/StatusIcon.tsx for why the stroke is
 * heavier than an icon font's.
 */

const BOX = '0 0 16 16';

/* Rays at a constant inner and outer radius (5.3 and 6.8 units), so the cardinal
   four and the diagonal four read as one wheel rather than as two crosses. */
const SUN = (
  <>
    <circle cx="8" cy="8" r="3.1" />
    <path d="M8 1.2V2.7M8 13.3V14.8M1.2 8H2.7M13.3 8H14.8" />
    <path d="M3.2 3.2 4.25 4.25M11.75 11.75 12.8 12.8M12.8 3.2 11.75 4.25M4.25 11.75 3.2 12.8" />
  </>
);

/* One closed crescent, not a disc with a bite taken out of it: two arcs of
   different radii sharing their endpoints. A moon drawn as circle-minus-circle
   needs a mask, and a mask does not follow `currentColor`. */
const MOON = <path d="M14 8.53A6 6 0 1 1 7.47 2A4.67 4.67 0 0 0 14 8.53Z" />;

export function ThemeToggle() {
  const { t } = useI18n();
  const theme = usePrefs((s) => s.theme);
  const toggleTheme = usePrefs((s) => s.toggleTheme);

  const dark = theme === 'dark';
  const label = t(dark ? 'theme.toLight' : 'theme.toDark');

  return (
    <button
      type="button"
      className="themetoggle tap"
      onClick={toggleTheme}
      aria-label={label}
      title={label}
    >
      <svg
        className="themetoggle__icon"
        viewBox={BOX}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        focusable="false"
      >
        {dark ? SUN : MOON}
      </svg>
    </button>
  );
}
