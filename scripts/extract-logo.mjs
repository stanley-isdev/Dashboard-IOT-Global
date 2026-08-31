// Extracts the brand logo that is embedded as a ~148 kB base64 data URI on one
// line of the approved mockup (docs/global-executive-dashboard.html, the
// <img class="mark"> element) and writes it out as a real file.
//
// Why this exists: a data URI that large has to be parsed on every page load
// and cannot be cached separately from the HTML. As a file it is cached once,
// served with a long max-age, and can be swapped for an SVG without touching
// any markup.
//
// Run: npm run extract:logo
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const source = resolve(root, 'docs/global-executive-dashboard.html');
const outDir = resolve(root, 'public/brand');
const outFile = resolve(outDir, 'one-stanley-narong-pat.png');

const html = await readFile(source, 'utf8');

// The mockup has exactly one data:image/png URI (the topbar logo).
const match = html.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/);
if (!match) {
  console.error(`No base64 PNG found in ${source}`);
  process.exit(1);
}

const bytes = Buffer.from(match[1], 'base64');
await mkdir(outDir, { recursive: true });
await writeFile(outFile, bytes);

console.log(`Wrote ${outFile} (${(bytes.length / 1024).toFixed(1)} kB)`);
console.log(
  'Note: this is a raster. At 58 px tall it will look soft on a 4K TV - ' +
    'ask the design owner for the original SVG (docs/DECISIONS.md D-F16).',
);
