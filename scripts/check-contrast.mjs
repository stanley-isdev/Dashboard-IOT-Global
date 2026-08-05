// Verifies the status palette against WCAG contrast minimums.
//
// Background: every status colour in the approved mockup is used as *text*
// (.pct.high, .kpi.run .value, .alert-time) and every one of them fails AA 4.5:1
// on the white panel. The fix is a two-token system — a `mark` token for fills,
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

const SURFACES = { panel: '#FFFFFF', panel2: '#F1F4F9', bg: '#F4F6FA' };

// Keep in sync with src/theme/tokens.css.
//
// Marks are checked against the *tinted* surfaces too, not just white. The
// mockup's green (#12A583) and grey (#8B93A3) clear 3:1 on #FFFFFF but fall to
// 2.83 and 2.80 on --panel-2, which is exactly where the ranking table's
// expanded plant rows sit. Checking one surface is how that ships unnoticed.
const MARK = {
  'status-good-mark': '#0C8F70',
  'status-warn-mark': '#C6790A',
  'status-crit-mark': '#E0333F',
  'status-nodata-mark': '#727C8D',
  'status-other-mark': '#7C6BB0',
};

// Desktop text: AA 4.5:1 on every surface.
const INK = {
  'status-good-ink': '#0B6E58',
  'status-warn-ink': '#8A5308',
  'status-crit-ink': '#B31C25',
  'status-nodata-ink': '#5B6472',
  'status-other-ink': '#5B4B8A',
  text: '#1B2333',
  sub: '#5A6273',
};

// Kiosk/TV text: AAA 7:1. Factory ambient light is high, panels are often
// glossy, and the viewer is ~3 m away. Applied via [data-density="tv"].
const INK_TV = {
  'status-good-ink': '#075744',
  'status-warn-ink': '#6E4206',
  'status-crit-ink': '#96131C',
  'status-nodata-ink': '#49505D',
  'status-other-ink': '#4C3E74',
  text: '#1B2333',
  sub: '#474E5D',
};

const TEXT_MIN = 4.5; // AA body text
const KIOSK_MIN = 7.0; // AAA — factory ambient light, 3 m viewing distance
const MARK_MIN = 3.0; // AA non-text graphic

let failed = 0;
const row = (name, hex, surface, value, min) => {
  const ok = value >= min;
  if (!ok) failed++;
  const flag = ok ? 'PASS' : 'FAIL';
  console.log(
    `  [${flag}] ${name.padEnd(20)} ${hex} on ${surface.padEnd(7)} ` +
      `${value.toFixed(2).padStart(5)}:1  (min ${min})`,
  );
};

const checkGroup = (label, tokens, min) => {
  console.log(`\n${label}`);
  for (const [name, hex] of Object.entries(tokens)) {
    for (const [sName, sHex] of Object.entries(SURFACES)) {
      row(name, hex, sName, contrast(hex, sHex), min);
    }
  }
};

checkGroup(
  'Mark tokens — fills/dots/pins/bars only, must clear 3:1 on every surface',
  MARK,
  MARK_MIN,
);
checkGroup('Ink tokens (desktop) — rendered as text, must clear AA 4.5:1', INK, TEXT_MIN);
checkGroup('Ink tokens (kiosk/TV) — must clear AAA 7:1', INK_TV, KIOSK_MIN);

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
