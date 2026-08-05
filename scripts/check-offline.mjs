// Fails the build if anything in dist/ still reaches out to a public CDN.
//
// This is the enforcement half of T-12. The mockup loaded Leaflet from
// unpkg.com and three typefaces from fonts.googleapis.com, which is fine on a
// laptop and fatal on a plant network with no public internet. Vendoring them
// is easy; *staying* vendored is the part that needs a test, because the next
// person to add a chart library will not think about it.
//
// The map tile host is deliberately NOT flagged: it is a runtime config value
// (public/config/runtime-config.json), an offline site sets it to null, and the
// bundled Natural Earth vector layer renders underneath regardless.
//
// Run: npm run check:offline   (after npm run build)
import { readdir, readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const dist = resolve(here, '../dist');

const FORBIDDEN = [
  'fonts.googleapis.com',
  'fonts.gstatic.com',
  'unpkg.com',
  'cdn.jsdelivr.net',
  'cdnjs.cloudflare.com',
  'ajax.googleapis.com',
];

const TEXTUAL = /\.(js|css|html|json|map|svg)$/i;

async function walk(dir) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await walk(full)));
    else out.push(full);
  }
  return out;
}

try {
  await stat(dist);
} catch {
  console.error('dist/ not found — run `npm run build` first.');
  process.exit(1);
}

const hits = [];
for (const file of await walk(dist)) {
  if (!TEXTUAL.test(file)) continue;
  const text = await readFile(file, 'utf8');
  for (const host of FORBIDDEN) {
    if (text.includes(host)) hits.push({ file: relative(dist, file), host });
  }
}

if (hits.length) {
  console.error('\nExternal CDN references found in the build output:\n');
  for (const { file, host } of hits) console.error(`  ${host}  <-  dist/${file}`);
  console.error('\nVendor the asset instead. See docs/DECISIONS.md (T-12).\n');
  process.exit(1);
}

console.log('No external CDN references in dist/ — offline deploy is safe.');
