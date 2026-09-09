// Verifies the status palette against WCAG contrast minimums, in both themes.
//
// Background: every status colour in the approved mockup is used as *text*
// (.pct.high, .kpi.run .value, .alert-time) and every one of them fails AA 4.5:1
// on the white panel. The fix is a two-token system - a `mark` token for fills,
// dots, pins and bars (needs only 3:1 as a non-text graphic) and an `ink` token
// for anything rendered as type (needs 4.5:1, and 7:1 in kiosk mode where the
// viewer is 3 m away in high ambient light).
//
// This runs in CI so a "let's just brighten the green" change fails the build
// instead of silently shipping unreadable numbers.
//
// Run: npm run check:contrast

/** WCAG 2.1 relative luminance. */
function luminance(hex) {
  const n = hex.replace('#', '');
  const rgb = [0, 2, 4].map((i) => parseInt(n.slice(i, i + 2), 16) / 255);
  const [r, g, b] = rgb.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

// ---------------------------------------------------------------------------
// The light theme - the board's default, and the artboard it was drawn from.
// ---------------------------------------------------------------------------

// The four surfaces text and marks actually land on. `panel3` is the ranking's
// sticky header - the darkest of them, and a real text surface, so it sets the
// binding constraint for every column label.
// (--band is #FFFFFF, i.e. identical to `panel`, so it needs no row of its own.
// If the masthead band ever stops being pure white, add it here.)
// `attention` is the ranking's critical-row tint. It carries the whole row -
// country, clock, percentages - so every ink has to clear it too. The pill-sized
// --status-crit-tint was the first choice and failed `sub` here at 4.4:1.
// `accentTint` and `accentTintStrong` are the brand-orange grounds a control
// that is *on* is drawn with - the open filter, the range in force, the
// selected language. They carry their own label, so they are text surfaces like
// the rest and every ink is measured on them. The pair was chosen by this
// script: two steps deeper and --accent-ink came out at 4.34:1.
const LIGHT_SURFACES = {
  panel: '#FFFFFF',
  panel2: '#F7F8FA',
  panel3: '#F2F4F7',
  bg: '#F4F6F9',
  attention: '#FDF4F3',
  accentTint: '#FDF3EA',
  accentTintStrong: '#FCEFE3',
};

// Keep in sync with src/theme/tokens.css.
//
// Marks are checked against every surface, not just white. The artboard's own
// no-data grey (#8B909A) measures 3.20:1 on the panel and would have passed a
// white-only check, but 2.83:1 on the page background - and that grey is the
// dot the map legend uses for "No data" on six of nine bases. It is darkened to
// #828790 here. Checking one surface is how that ships unnoticed.
const LIGHT_MARK = {
  'status-good-mark': '#12946A',
  'status-warn-mark': '#D9660A',
  'status-crit-mark': '#D63B30',
  'status-nodata-mark': '#828790',
  'status-other-mark': '#7166B5',
  // Not a status token: the %OA trend series. It is still a mark on the same
  // surfaces, so it is held to the same 3:1 - see tokens.css for why the line
  // stopped being green.
  'trend-line': '#0B74B8',
  // Nor is this one: brand orange, as the marks that carry a meaning wear it -
  // the selected board tab's top edge and the focus ring. The *decorative*
  // orange (--accent, #EB7113) is deliberately absent and stays exempt, on the
  // same grounds the note at the top of this file gives: nothing is read from
  // it. A mark a keyboard user has to find is not decoration, hence this row.
  //
  // Do not be tempted to alias this row onto the brand hue. #F5871F measures
  // 2.51:1 on the panel and 2.20:1 on the worst surface in the list above - it
  // does not pass as a mark on any of them, which is why the mark is cut a step
  // deeper than the brand value and always has been. The brand orange's own
  // place on the board is as a *ground*, which is the block at the bottom of
  // this file, not this one.
  'accent-mark': '#D86E0A',
};

// Desktop text: AA 4.5:1 on every surface.
//
// `sub` is the design's own #6B6B64. Its two quieter text greys, #86867E
// (3.27:1) and #9A9A92 (2.53:1), have no passing equivalent below this one, so
// every text use of them resolves here - see the note in tokens.css.
const LIGHT_INK = {
  'status-good-ink': '#0F7A58',
  'status-warn-ink': '#A85410',
  'status-crit-ink': '#C0362C',
  'status-nodata-ink': '#5C616B',
  'status-other-ink': '#574B93',
  // Brand orange as type. No longer the label on a control that is on - that
  // moved to a filled ground with a dark label, see LIGHT_FILL below - but
  // still the breadcrumb links, the sort glyph, the mixed-scope tick and every
  // hover wash. Same 4.5:1 as everything here, and it is this row that forces
  // the token to a lightness that cannot look like the logo. Nothing to be done
  // about that: 4.5:1 on #F2F4F7 caps an orange at about L 35%.
  'accent-ink': '#AA5708',
  text: '#16181D',
  'ink-2': '#3A3D45',
  sub: '#676C76',
};

// Kiosk/TV text: AAA 7:1. Factory ambient light is high, panels are often
// glossy, and the viewer is ~3 m away. Applied via [data-density="tv"].
const LIGHT_INK_TV = {
  'status-good-ink': '#0A5B41',
  'status-warn-ink': '#7A4109',
  'status-crit-ink': '#8F2419',
  'status-nodata-ink': '#494E57',
  'status-other-ink': '#443A75',
  'accent-ink': '#7E4006',
  text: '#16181D',
  'ink-2': '#3A3D45',
  sub: '#4A4E57',
};

// ---------------------------------------------------------------------------
// The dark theme - :root[data-theme='dark'] in tokens.css.
//
// The same rules, measured the other way up. Two things move with the palette,
// and both are easy to get wrong by analogy:
//
//   1. `panel3` is still the binding surface, but it is now the *lightest* one
//      rather than the darkest. An ink added here has to clear the top of the
//      surface ladder, not the bottom.
//   2. An ink is its mark *lightened*, where on white it is the mark darkened.
//      A dark-theme ink that reads as "the same green, a bit deeper" is a
//      failing value, and this table is where that gets caught.
//
// `attention` is the critical-row wash, same job as its light counterpart: it
// carries a whole 42px row, so every ink is measured on it. --band is identical
// to --panel here too, so it needs no row.
// ---------------------------------------------------------------------------

const DARK_SURFACES = {
  panel: '#101A2C',
  panel2: '#16223A',
  panel3: '#1C2942',
  bg: '#0A1020',
  attention: '#2C1821',
  accentTint: '#2A1D0F',
  accentTintStrong: '#33230F',
};

const DARK_MARK = {
  'status-good-mark': '#10C987',
  'status-warn-mark': '#F0A52A',
  'status-crit-mark': '#EF4A5C',
  'status-nodata-mark': '#7D8BA1',
  'status-other-mark': '#8B7CE8',
  'trend-line': '#38BDF8',
  // The same value as --accent in this theme, unlike the light one - see the
  // note on the pair in tokens.css.
  'accent-mark': '#F2A94A',
};

const DARK_INK = {
  'status-good-ink': '#3FE0A8',
  'status-warn-ink': '#FBBF4A',
  'status-crit-ink': '#FF7080',
  'status-nodata-ink': '#A3B0C2',
  'status-other-ink': '#A99BF5',
  'accent-ink': '#FFB366',
  // Not #FFFFFF: pure white on a near-black ground haloes on the glossy panels
  // these boards run on, and at 12px that bloom closes up Thai tone marks.
  text: '#EEF2F8',
  'ink-2': '#C3CCDA',
  sub: '#94A2B8',
};

const DARK_INK_TV = {
  'status-good-ink': '#6FE9BD',
  'status-warn-ink': '#FCD34D',
  'status-crit-ink': '#FF9AA4',
  'status-nodata-ink': '#C0CBDB',
  'status-other-ink': '#C3B8FF',
  // Unchanged from DARK_INK: it clears AAA as it stands. See tokens.css.
  'accent-ink': '#FFB366',
  text: '#F4F7FB',
  'ink-2': '#D8E0EC',
  sub: '#B3BFD0',
};

// ---------------------------------------------------------------------------
// The status pills.
//
// A Run/Stop pill is a tint with its own ink set on it, and until the dark
// theme arrived that pair was never measured: a tint is not one of the five
// surfaces above, so `status-good-ink` on `status-good-tint` went unchecked in
// both themes. On white the two are far enough apart that it did not matter. On
// a dark ground, "a dark green pill with green text on it" is exactly the
// mistake that is easy to make and impossible to see in a swatch grid, so each
// pair is now held to the same minimums as any other text.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// The filled control.
//
// The orange ground a control that is *on* is drawn with: the filter capsules,
// the board tab in front, the range in force, the alert count. This file is the
// reason nobody can ship `background: var(--accent)` with a white label on it,
// which measures 2.4:1.
//
// Measured as a text pair rather than against the five surfaces, because that
// is what it is: --accent-on-fill is the label, --accent-fill is the only thing
// it is ever set on. The hover ground is measured too - a hover that drops the
// label below AA for as long as the pointer is over it is still a failure, and
// it is the state a reader is in at the moment they read the word.
//
// The two themes do NOT run the same way round any more, and the light one is
// this file's one waived pair.
//
// ---- the waiver ----
//
// A white label on the brand orange measures 2.51:1, where AA wants 4.5:1. It
// is shipped anyway, by an explicit and repeated design instruction taken after
// the number was quoted. `waived` on the table below is what says so.
//
// Read what that flag does before reaching for it again. It does not silence
// the row: the ratio still prints, on every run, flagged WAIVE and listed again
// in the summary at the bottom. What it does is stop the row failing the build,
// so that one accepted deviation does not force the whole gate to be switched
// off - which is the actual risk to a check like this one. A waiver is a debt
// somebody chose to take on, recorded where the next person will see it; it is
// not a way to make a colour pass.
//
// Do not add a second one without the same conversation. And do not "fix" this
// row by editing the hex here - this table describes what tokens.css ships, and
// a value changed only here measures a colour nobody sees.
// ---------------------------------------------------------------------------

const WAIVER_WHITE_ON_ORANGE =
  'white on the brand orange, accepted by design decision - see tokens.css';

// ---------------------------------------------------------------------------
// The %OA inks.
//
// Not part of the status palette and measured apart from it, because they are
// the one group on this board that was chosen by matching something rather than
// by measuring it. The operators' `Machine Status V2.0` panel paints its own %OA
// in Tailwind's emerald/amber/red 600, and on 2026-09-08 the design owner asked
// for the figure here to be the same colour as the figure on the wall.
//
// ---- the second waiver ----
//
// The note over WAIVER_WHITE_ON_ORANGE says not to add one of these without the
// same conversation. This is that conversation's outcome, and it is a larger
// debt than the first: three tokens rather than one, and they land on *readings*
// - the KPI figure, the ranking's %OA column, the plant rows in the drawer -
// rather than on a label whose word is also its own shape.
//
// What was quoted before it was taken, on the ranking header that binds every
// other ink in this file: green 3.42:1, amber 2.89:1, red 4.38:1, against 4.5:1.
// The amber does not clear even the 3:1 owed to a non-text mark. The dark theme
// does not rescue it so much as rotate it - there the red is the worst of the
// three at 3.01:1, which is the tier a reader most needs to catch.
//
// One value per token in both themes and both densities, matching tokens.css:
// "the panel's colours" was the instruction, and a per-theme variant would be a
// different colour. The kiosk rows are therefore the same hexes held to 7:1 and
// are not printed separately - the desktop rows below already record the debt,
// and eighty-odd more WAIVE lines would bury the one waiver that predates this.
//
// These rows are measured on every run for the reason the rest of the file is:
// so that a later "let's just brighten the green" is a visible change to a
// recorded number, not a silent one.
// ---------------------------------------------------------------------------

const WAIVER_PANEL_OA =
  "the Machine Status V2.0 panel's own %OA colours, accepted by design decision - see tokens.css";

// Both themes read the same three values. Deliberate - see above.
const OA_INK = {
  'oa-good-ink': '#059669',
  'oa-warn-ink': '#D97706',
  'oa-crit-ink': '#DC2626',
};

const LIGHT_FILL = {
  'accent-on-fill': '#FFFFFF',
  fill: '#F5871F',
  // Deeper than the ground, not lighter, now the label is white: the pointer
  // has to raise the label's contrast (3.41:1) rather than drop it. This is
  // --accent-mark's value, the same hue one step down.
  fillStrong: '#D86E0A',
  waived: WAIVER_WHITE_ON_ORANGE,
};

// Unchanged from LIGHT_FILL. Every other ink in the tv block is deepened to
// clear AAA; this pair has no AA to promote, and the only lightness where
// deepening would mean anything is one that stops being the brand orange. The
// waiver is the same at both densities and worse at this one - see tokens.css.
const LIGHT_FILL_TV = LIGHT_FILL;

const DARK_FILL = {
  'accent-on-fill': '#0A1020',
  fill: '#FFB366',
  fillStrong: '#F2A94A',
};

// Unchanged from DARK_FILL: both grounds already clear AAA against the page
// ground the label is set in. See the note in tokens.css.
//
// No waiver here, and that is deliberate rather than an omission. The rule that
// produced the light theme's white label named a colour - #F5871F - and this
// theme's ground is #FFB366. White on it is 1.77:1, which is not a legibility
// trade but an invisible label, so the dark board keeps the pair that passes.
const DARK_FILL_TV = DARK_FILL;

// The filter capsules need no table of their own. Their on-state is
// --accent-ink inside an --accent-mark outline on the row's own ground, and
// both of those tokens are already measured against every surface by the ink
// and mark groups above - which is the point of drawing a state out of the
// palette that exists rather than adding grounds to it.

const LIGHT_TINT = {
  good: '#E3F5EE',
  warn: '#FBF0DD',
  crit: '#FDEAE8',
  nodata: '#EEF0F3',
  other: '#EEECF8',
};

const DARK_TINT = {
  good: '#0E2B23',
  warn: '#2E2412',
  crit: '#34181E',
  nodata: '#1E293B',
  other: '#231F3E',
};

const THEMES = [
  {
    name: 'light',
    surfaces: LIGHT_SURFACES,
    mark: LIGHT_MARK,
    ink: LIGHT_INK,
    inkTv: LIGHT_INK_TV,
    tint: LIGHT_TINT,
    fill: LIGHT_FILL,
    fillTv: LIGHT_FILL_TV,
  },
  {
    name: 'dark',
    surfaces: DARK_SURFACES,
    mark: DARK_MARK,
    ink: DARK_INK,
    inkTv: DARK_INK_TV,
    tint: DARK_TINT,
    fill: DARK_FILL,
    fillTv: DARK_FILL_TV,
  },
];

const TEXT_MIN = 4.5; // AA body text
const KIOSK_MIN = 7.0; // AAA - factory ambient light, 3 m viewing distance
const MARK_MIN = 3.0; // AA non-text graphic

let failed = 0;
const waived = [];

/*
 * One measured pair, printed.
 *
 * `waiver` is a reason string, and it is present only on a pair somebody has
 * explicitly decided to ship below its minimum. A failing row that has one
 * prints WAIVE, is collected for the summary at the bottom, and does not fail
 * the build; a failing row without one fails it, which is the whole reason this
 * runs in CI.
 *
 * The build not going red is the point, and it is also the risk. A gate that
 * fails on a deviation the team has already accepted gets switched off, and
 * then it stops catching the accidental ones too - so the accepted deviation is
 * recorded here instead, in front of anyone who runs the script, rather than
 * either failing forever or disappearing.
 *
 * A row that passes prints PASS whether or not a waiver was offered. A waiver
 * on a passing pair is dead weight and reads as though the pair were broken.
 */
const row = (name, hex, surface, value, min, waiver, collect = true) => {
  const ok = value >= min;
  const flag = ok ? 'PASS' : waiver ? 'WAIVE' : 'FAIL';
  if (!ok && !waiver) failed++;
  if (!ok && waiver && collect) {
    waived.push(`${name} on ${surface}: ${value.toFixed(2)}:1 (min ${min}) - ${waiver}`);
  }
  console.log(
    `  [${flag.padEnd(4)}] ${name.padEnd(20)} ${hex} on ${surface.padEnd(11)} ` +
      `${value.toFixed(2).padStart(5)}:1  (min ${min})`,
  );
};

const checkGroup = (label, tokens, surfaces, min) => {
  console.log(`\n${label}`);
  for (const [name, hex] of Object.entries(tokens)) {
    for (const [sName, sHex] of Object.entries(surfaces)) {
      row(name, hex, sName, contrast(hex, sHex), min);
    }
  }
};

/*
 * A waived group: every surface printed, one summary line filed.
 *
 * checkGroup files a line per pair, which is right when a waiver is the rare
 * exception it was written to be. Three tokens across seven surfaces is not that
 * shape - it would file twenty-one near-identical lines and push the white-on-
 * orange waiver off the end of the summary. So the rows still print in full and
 * the debt is recorded once per token, at the worst surface it was measured on,
 * which is the number anyone deciding whether to keep it would ask for. The
 * theme goes on that line: a token that reads the same hex in both still
 * measures differently in each, and a bare token name would file two lines that
 * look like duplicates.
 */
const checkWaivedGroup = (label, tokens, surfaces, min, waiver, theme) => {
  console.log(`
${label}`);
  for (const [name, hex] of Object.entries(tokens)) {
    let worst = null;
    for (const [sName, sHex] of Object.entries(surfaces)) {
      const value = contrast(hex, sHex);
      row(name, hex, sName, value, min, waiver, false);
      if (worst === null || value < worst.value) worst = { sName, value };
    }
    if (worst.value < min) {
      waived.push(
        `${name} (${theme}) on ${worst.sName}, worst of ${Object.keys(surfaces).length}: ` +
          `${worst.value.toFixed(2)}:1 (min ${min}) - ${waiver}`,
      );
    }
  }
};

// Each ink against its own tint only - a green ink never lands on an amber pill.
const checkPills = (label, ink, tint, min) => {
  console.log(`\n${label}`);
  for (const [tone, tintHex] of Object.entries(tint)) {
    const inkName = `status-${tone}-ink`;
    row(inkName, ink[inkName], `${tone}-tint`, contrast(ink[inkName], tintHex), min);
  }
};

// The label on the filled control, on the ground it is filled with and on that
// ground's hover. Two rows, because the hover is the state a pointer user is in
// while they read the word.
const checkFill = (label, fill, min) => {
  console.log(`\n${label}`);
  const ink = fill['accent-on-fill'];
  row('accent-on-fill', ink, 'accent-fill', contrast(ink, fill.fill), min, fill.waived);
  row('accent-on-fill', ink, 'fill:hover', contrast(ink, fill.fillStrong), min, fill.waived);
};

const RULE = '='.repeat(74);

for (const theme of THEMES) {
  console.log(`\n${RULE}\n${theme.name.toUpperCase()} THEME\n${RULE}`);
  checkGroup(
    'Mark tokens - fills/dots/pins/bars only, must clear 3:1 on every surface',
    theme.mark,
    theme.surfaces,
    MARK_MIN,
  );
  checkGroup(
    'Ink tokens (desktop) - rendered as text, must clear AA 4.5:1',
    theme.ink,
    theme.surfaces,
    TEXT_MIN,
  );
  checkWaivedGroup(
    "The %OA inks - text, AA 4.5:1, waived to match the operators' panel",
    OA_INK,
    theme.surfaces,
    TEXT_MIN,
    WAIVER_PANEL_OA,
    theme.name,
  );
  checkGroup('Ink tokens (kiosk/TV) - must clear AAA 7:1', theme.inkTv, theme.surfaces, KIOSK_MIN);
  checkPills(
    'Status pills (desktop) - each ink on its own tint, AA 4.5:1',
    theme.ink,
    theme.tint,
    TEXT_MIN,
  );
  checkPills(
    'Status pills (kiosk/TV) - each ink on its own tint, AAA 7:1',
    theme.inkTv,
    theme.tint,
    KIOSK_MIN,
  );
  checkFill(
    'Filled control (desktop) - the label on its own ground, AA 4.5:1',
    theme.fill,
    TEXT_MIN,
  );
  checkFill('Filled control (kiosk/TV) - AAA 7:1', theme.fillTv, KIOSK_MIN);
}

console.log(
  '\nReminder: contrast is necessary but not sufficient. Red/amber sit at ' +
    'deutan deltaE 1.7-5.6 no matter which shades are chosen, so every status ' +
    'must also carry a glyph and a word. See src/domain/status.ts.\n',
);

// Printed above the pass/fail line, not below it, so it is the last thing read
// before the verdict rather than a footnote after it.
if (waived.length > 0) {
  console.log(`${waived.length} pair(s) shipped below the minimum by decision:`);
  for (const line of waived) console.log(`  - ${line}`);
  console.log('');
}

if (failed > 0) {
  console.error(`${failed} contrast check(s) failed.`);
  process.exit(1);
}
console.log(
  waived.length > 0
    ? `All contrast checks passed, with ${waived.length} waived pair(s) above.\n`
    : 'All contrast checks passed.\n',
);
