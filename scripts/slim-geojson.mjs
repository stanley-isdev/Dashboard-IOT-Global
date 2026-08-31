// Shrinks the Natural Earth countries file to what a world-view basemap needs.
//
// Natural Earth 1:110m ships at ~820 kB because every feature carries about
// ninety attributes (population estimates, alternate names in a dozen
// languages, Wikidata ids) and full-precision coordinates. This map draws
// country outlines between zoom 1 and 6 and labels nothing, so all of that is
// dead weight on a plant network.
//
// We keep the geometry and the ISO code, and round coordinates to two decimal
// places - about 1.1 km at the equator, well under one screen pixel at the
// zoom levels this map allows.
//
// Source: github.com/nvkelso/natural-earth-vector, public domain.
//
// Run: node scripts/slim-geojson.mjs
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const file = resolve(here, '../public/geo/world-110m.geo.json');

const PRECISION = 2;

function roundCoords(node) {
  if (typeof node[0] === 'number') {
    return [
      Math.round(node[0] * 10 ** PRECISION) / 10 ** PRECISION,
      Math.round(node[1] * 10 ** PRECISION) / 10 ** PRECISION,
    ];
  }
  return node.map(roundCoords);
}

const before = await readFile(file, 'utf8');
const fc = JSON.parse(before);

const slim = {
  type: 'FeatureCollection',
  features: fc.features.map((f) => ({
    type: 'Feature',
    properties: {
      // ISO_A2 is '-99' for a handful of disputed territories; fall back to the
      // name so nothing ends up with an empty key.
      iso:
        f.properties.ISO_A2 && f.properties.ISO_A2 !== '-99'
          ? f.properties.ISO_A2
          : (f.properties.ISO_A2_EH ?? f.properties.NAME ?? ''),
    },
    geometry: {
      type: f.geometry.type,
      coordinates: roundCoords(f.geometry.coordinates),
    },
  })),
};

const after = JSON.stringify(slim);
await writeFile(file, after);

const kb = (n) => (n / 1024).toFixed(0);
console.log(
  `world-110m.geo.json: ${kb(Buffer.byteLength(before))} kB -> ${kb(Buffer.byteLength(after))} kB ` +
    `(${slim.features.length} countries)`,
);
