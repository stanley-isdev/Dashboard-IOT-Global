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
const LIGHT_SURFACES = {
  panel: '#FFFFFF',
  panel2: '#F7F8FA',
  panel3: '#F2F4F7',
  bg: '#F4F6F9',
  attention: '#FDF4F3',
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
  'status-warn-mark': '#B3771A',
  'status-crit-mark': '#D63B30',
  'status-nodata-mark': '#828790',
  'status-other-mark': '#7166B5',
  // Not a status token: the %OA trend series. It is still a mark on the same
  // surfaces, so it is held to the same 3:1 - see tokens.css for why the line
  // stopped being green.
  'trend-line': '#0B74B8',
};

// Desktop text: AA 4.5:1 on every surface.
//
// `sub` is the design's own #6B6B64. Its two quieter text greys, #86867E
// (3.27:1) and #9A9A92 (2.53:1), have no passing equivalent below this one, so
// every text use of them resolves here - see the note in tokens.css.
const LIGHT_INK = {
  'status-good-ink': '#0F7A58',
  'status-warn-ink': '#8A5C11',
  'status-crit-ink': '#C0362C',
  'status-nodata-ink': '#5C616B',
  'status-other-ink': '#574B93',
  text: '#16181D',
  'ink-2': '#3A3D45',
  sub: '#676C76',
};

// Kiosk/TV text: AAA 7:1. Factory ambient light is high, panels are often
// glossy, and the viewer is ~3 m away. Applied via [data-density="tv"].
const LIGHT_INK_TV = {
  'status-good-ink': '#0A5B41',
  'status-warn-ink': '#6B470B',
  'status-crit-ink': '#8F2419',
  'status-nodata-ink': '#494E57',
  'status-other-ink': '#443A75',
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
};

const DARK_MARK = {
  'status-good-mark': '#10C987',
  'status-warn-mark': '#F0A52A',
  'status-crit-mark': '#EF4A5C',
  'status-nodata-mark': '#7D8BA1',
  'status-other-mark': '#8B7CE8',
  'trend-line': '#38BDF8',
};

const DARK_INK = {
  'status-good-ink': '#3FE0A8',
  'status-warn-ink': '#FBBF4A',
  'status-crit-ink': '#FF7080',
  'status-nodata-ink': '#A3B0C2',
  'status-other-ink': '#A99BF5',
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
  },
  {
    name: 'dark',
    surfaces: DARK_SURFACES,
    mark: DARK_MARK,
    ink: DARK_INK,
    inkTv: DARK_INK_TV,
    tint: DARK_TINT,
  },
];

const TEXT_MIN = 4.5; // AA body text
const KIOSK_MIN = 7.0; // AAA - factory ambient light, 3 m viewing distance
const MARK_MIN = 3.0; // AA non-text graphic

let failed = 0;
const row = (name, hex, surface, value, min) => {
  const ok = value >= min;
  if (!ok) failed++;
  const flag = ok ? 'PASS' : 'FAIL';
  console.log(
    `  [${flag}] ${name.padEnd(20)} ${hex} on ${surface.padEnd(11)} ` +
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

// Each ink against its own tint only - a green ink never lands on an amber pill.
const checkPills = (label, ink, tint, min) => {
  console.log(`\n${label}`);
  for (const [tone, tintHex] of Object.entries(tint)) {
    const inkName = `status-${tone}-ink`;
    row(inkName, ink[inkName], `${tone}-tint`, contrast(ink[inkName], tintHex), min);
  }
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
}

console.log(
  '\nReminder: contrast is necessary but not sufficient. Red/amber sit at ' +
    'deutan deltaE 1.7-5.6 no matter which shades are chosen, so every status ' +
    'must also carry a glyph and a word. See src/domain/status.ts.\n',
);

if (failed > 0) {
  console.error(`${failed} contrast check(s) failed.`);
  process.exit(1);
}
console.log('All contrast checks passed.\n');
