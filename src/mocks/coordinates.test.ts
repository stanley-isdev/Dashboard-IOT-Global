import { describe, expect, it } from 'vitest';
import { zGlobalOverview, zMeta } from '../api/contract';
import { buildGlobalOverview, buildMeta } from './generate';
import { COMPANIES } from './masterData';

/**
 * The nine sites sit exactly where Master Data says they do.
 *
 * The map pins are not decorative. MapLabelLayer puts each dot on
 * `map.latLngToContainerPoint([company.lat, company.lng])`, so a coordinate that
 * has drifted by a rounding step is a dot on the wrong side of a road, and
 * nothing on the board would say so - a pin looks equally confident wherever it
 * lands. This is the one thing on the map that can be wrong silently.
 *
 * Two ways it could drift, and both are covered here:
 *
 *   - the seed table itself is edited, mistyped, or "tidied" to fewer decimals;
 *   - a generator, a schema, or the JSON hop rounds it on the way to the pin.
 *
 * Hence the literals below rather than a read of COMPANIES: a test that compares
 * the table to itself proves nothing about the table. These are the surveyed
 * figures from section 4 of docs/DESIGN.md, typed out again on purpose.
 *
 * `toBe` is Object.is, i.e. exact IEEE-754 identity - not a tolerance. There is
 * no such thing as an acceptable drift here, because there is no process that
 * should be moving these numbers at all.
 */
const SURVEYED: Record<string, { lat: number; lng: number }> = {
  THS: { lat: 14.006904532327685, lng: 100.56213418111764 },
  ASI: { lat: 14.045689204453973, lng: 100.43391089831499 },
  VNS: { lat: 21.0078991790763, lng: 105.96337126776004 },
  ISE: { lat: -6.2555455142982845, lng: 106.49968179637503 },
  STJ: { lat: 35.38815535277727, lng: 139.2082217038006 },
  SUS: { lat: 39.92641143817483, lng: -83.41551660704249 },
  IIS: { lat: 42.3364642871659, lng: -85.2757240901681 },
  SMX: { lat: 21.39244045633582, lng: -101.87831543037854 },
  SEH: { lat: 47.75733069569861, lng: 19.953289541127084 },
};

const now = new Date('2026-08-25T10:00:00Z');
const codes = Object.keys(SURVEYED);

describe('site coordinates', () => {
  it('has every surveyed site in the seed table and no others', () => {
    expect([...COMPANIES.map((c) => c.code)].sort()).toEqual([...codes].sort());
  });

  it('holds the surveyed figure to the last decimal in the seed table', () => {
    for (const c of COMPANIES) {
      expect(c.lat, `${c.code} lat`).toBe(SURVEYED[c.code].lat);
      expect(c.lng, `${c.code} lng`).toBe(SURVEYED[c.code].lng);
    }
  });

  /*
   * Through the schema and a JSON round trip, because that is the payload the
   * browser actually receives - an in-process object would not catch a
   * serialisation step that shortened the number.
   */
  it('carries it unrounded into the payload the map reads', () => {
    const overview = zGlobalOverview.parse(
      JSON.parse(
        JSON.stringify(
          buildGlobalOverview(now, 'default', { range: '24h', process: 'all', region: 'all', plant: 'all' }),
        ),
      ),
    );
    const meta = zMeta.parse(JSON.parse(JSON.stringify(buildMeta(now))));

    expect(overview.companies).toHaveLength(codes.length);
    expect(meta.companies).toHaveLength(codes.length);

    for (const code of codes) {
      const onMap = overview.companies.find((c) => c.code === code);
      const inMeta = meta.companies.find((c) => c.code === code);
      expect(onMap, `${code} missing from global overview`).toBeDefined();
      expect(inMeta, `${code} missing from meta`).toBeDefined();
      expect(onMap!.lat, `${code} lat on the map`).toBe(SURVEYED[code].lat);
      expect(onMap!.lng, `${code} lng on the map`).toBe(SURVEYED[code].lng);
      expect(inMeta!.lat, `${code} lat in meta`).toBe(SURVEYED[code].lat);
      expect(inMeta!.lng, `${code} lng in meta`).toBe(SURVEYED[code].lng);
    }
  });
});
