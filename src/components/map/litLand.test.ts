import type { FeatureCollection, Position } from 'geojson';
import { describe, expect, it } from 'vitest';
import { litLandmasses, type SitePoint } from './litLand';
// Vite's ?raw rather than fs: the app tsconfig has no node types, and this is
// the same file the layer fetches at runtime.
import worldRaw from '../../../public/geo/world-110m.geo.json?raw';

/*
 * The real outline file, not a fixture. What this module has to get right is a
 * property of Natural Earth's actual geometry - that the United States is ten
 * polygons and one of them is Alaska - and a hand-written square would test the
 * ray casting while proving nothing about the case that caused the module to
 * exist.
 */
const world = JSON.parse(worldRaw) as FeatureCollection;

/**
 * The surveyed coordinates, copied from the master data the server holds
 * (server/src/config/masterData.ts). They lived in src/mocks/masterData.ts
 * until the generator was removed.
 *
 * Tagged with their base codes, because that is what the layer styles on: the
 * cut is made once against the whole fleet and a region tick only changes which
 * of these codes count as ticked. See `LitProps.codes`.
 */
const BASES: Record<string, SitePoint> = {
  THS: { country_code: 'TH', lat: 14.006904532327685, lng: 100.56213418111764 },
  ASI: { country_code: 'TH', lat: 14.045689204453973, lng: 100.43391089831499 },
  STJ: { country_code: 'JP', lat: 35.38815535277727, lng: 139.2082217038006 },
  SEH: { country_code: 'HU', lat: 47.75733069569861, lng: 19.953289541127084 },
  VNS: { country_code: 'VN', lat: 21.0078991790763, lng: 105.96337126776004 },
  ISE: { country_code: 'ID', lat: -6.2555455142982845, lng: 106.49968179637503 },
  SUS: { country_code: 'US', lat: 39.92641143817483, lng: -83.41551660704249 },
  IIS: { country_code: 'US', lat: 42.3364642871659, lng: -85.2757240901681 },
  SMX: { country_code: 'MX', lat: 21.39244045633582, lng: -101.87831543037854 },
};
const ALL = Object.entries(BASES).map(([code, site]) => ({ ...site, code }));

/** Does any lit polygon in the result cover this point? */
function isLitAt(result: FeatureCollection, lat: number, lng: number): boolean {
  return result.features.some((f) => {
    if (f.properties?.['lit'] !== true) return false;
    const g = f.geometry;
    const polys: Position[][][] =
      g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
    return polys.some((rings) => {
      const hit = (ring: Position[]) => {
        let inside = false;
        for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
          const [xi, yi] = ring[i];
          const [xj, yj] = ring[j];
          if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
        }
        return inside;
      };
      return hit(rings[0]) && !rings.slice(1).some(hit);
    });
  });
}

describe('litLandmasses', () => {
  it('lights the ground under every base', () => {
    const out = litLandmasses(world, ALL);
    for (const [code, site] of Object.entries(BASES)) {
      expect(isLitAt(out, site.lat, site.lng), `${code} is not on lit ground`).toBe(true);
    }
  });

  /*
   * The bug this module was written for. Alaska, Hawaii and the four other
   * US pieces are the same GeoJSON feature as the lower 48; a country-keyed
   * fill painted all ten.
   */
  it('leaves Alaska and Hawaii grey while the lower 48 is orange', () => {
    const out = litLandmasses(world, ALL);
    expect(isLitAt(out, 64.5, -152.0)).toBe(false); // interior Alaska
    expect(isLitAt(out, 19.6, -155.5)).toBe(false); // Hawaii, the big island
    expect(isLitAt(out, 39.9, -83.4)).toBe(true); // Ohio, where SUS is
  });

  it('lights Java and not the rest of Indonesia', () => {
    const out = litLandmasses(world, ALL);
    expect(isLitAt(out, -6.26, 106.5)).toBe(true); // Java, where ISE is
    expect(isLitAt(out, 0.5, 101.5)).toBe(false); // Sumatra
    expect(isLitAt(out, -4.0, 137.0)).toBe(false); // Papua
  });

  it('lights no ground in a country with no base', () => {
    const out = litLandmasses(world, ALL);
    expect(isLitAt(out, 48.9, 2.35)).toBe(false); // Paris
    expect(isLitAt(out, 39.9, 116.4)).toBe(false); // Beijing
    expect(isLitAt(out, -33.9, 151.2)).toBe(false); // Sydney
    expect(isLitAt(out, 55.75, 37.6)).toBe(false); // Moscow
  });

  it('lights the two Thai bases as one landmass, not two features', () => {
    const out = litLandmasses(world, [BASES.THS, BASES.ASI]);
    const thai = out.features.filter((f) => f.properties?.['iso'] === 'TH');
    expect(thai).toHaveLength(1);
    expect(thai[0].properties?.['lit']).toBe(true);
  });

  /*
   * The fallback that keeps a base from vanishing. 110m outlines generalise a
   * coastline by kilometres, so a real site can sit outside its own country;
   * it must still light that country's nearest land, and only that country's.
   */
  it('falls back to the nearest landmass of the same country when the point misses land', () => {
    const offshore: SitePoint = { country_code: 'TH', lat: 12.0, lng: 100.0 }; // Gulf of Thailand
    const out = litLandmasses(world, [offshore]);
    const lit = out.features.filter((f) => f.properties?.['lit'] === true);
    expect(lit).toHaveLength(1);
    expect(lit[0].properties?.['iso']).toBe('TH');
  });

  it('never lights a neighbour, even when the neighbour is nearer', () => {
    // A point inside Cambodia, but recorded as a Thai base.
    const out = litLandmasses(world, [{ country_code: 'TH', lat: 12.5, lng: 105.0 }]);
    const lit = out.features.filter((f) => f.properties?.['lit'] === true);
    expect(lit.map((f) => f.properties?.['iso'])).toEqual(['TH']);
  });

  it('lights nothing, and keeps every country, when there are no bases', () => {
    const out = litLandmasses(world, []);
    expect(out.features).toHaveLength(world.features.length);
    expect(out.features.every((f) => f.properties?.['lit'] === false)).toBe(true);
  });

  it('ignores a base with no usable coordinate rather than throwing', () => {
    const out = litLandmasses(world, [{ country_code: 'TH', lat: NaN, lng: NaN }]);
    expect(out.features.some((f) => f.properties?.['lit'] === true)).toBe(false);
  });

  /*
   * The straight top edge of the United States is the 49th parallel and not a
   * clipped polygon - thirteen vertices at exactly lat 49.0000, the way Natural
   * Earth ships them, plus the Northwest Angle step at -95.16. Asserted because
   * a border that looks drawn with a ruler is the first thing anyone points at,
   * and the answer has to be checkable rather than remembered.
   */
/*
   * The tag the layer styles on.
   *
   * The cut is made against the fleet as commissioned and mounted once, so
   * "is this ground ours" cannot be baked into the geometry any more - it has to
   * be answerable from the feature against whatever the region filter currently
   * has ticked. That is what `codes` is for, and the pieces have to carry the
   * right ones or a filter change restyles the wrong country.
   */
  it('tags each lit landmass with the bases standing on it', () => {
    const out = litLandmasses(world, ALL);
    const codesFor = (iso: string) =>
      out.features
        .filter((f) => f.properties?.['iso'] === iso && f.properties?.['lit'] === true)
        .flatMap((f) => f.properties?.['codes'] as string[])
        .sort();

    expect(codesFor('JP')).toEqual(['STJ']);
    expect(codesFor('HU')).toEqual(['SEH']);
    expect(codesFor('MX')).toEqual(['SMX']);
    /* Both Thai bases stand on the mainland, and both US bases on the lower 48,
       so each landmass carries the pair - which is what lets the layer keep the
       ground lit when only one of them is unticked. */
    expect(codesFor('TH')).toEqual(['ASI', 'THS']);
    expect(codesFor('US')).toEqual(['IIS', 'SUS']);
  });

  it('leaves no codes on ground nobody stands on', () => {
    const out = litLandmasses(world, ALL);
    for (const f of out.features) {
      const codes = f.properties?.['codes'] as string[];
      expect(Array.isArray(codes)).toBe(true);
      if (f.properties?.['lit'] === true) expect(codes.length).toBeGreaterThan(0);
      else expect(codes).toEqual([]);
    }
  });

  /*
   * Alaska and Hawaii are the same feature as the lower 48 in the source, and
   * the cut has to hand them back as a piece the styling can never light - the
   * bug the module was written for, restated for the tagged form.
   */
  it('cuts the unlit landmasses of a lit country into a piece with no codes', () => {
    const out = litLandmasses(world, ALL);
    const us = out.features.filter((f) => f.properties?.['iso'] === 'US');
    expect(us.filter((f) => f.properties?.['lit'] === true)).toHaveLength(1);
    const rest = us.filter((f) => f.properties?.['lit'] === false);
    expect(rest).toHaveLength(1);
    expect(rest[0].properties?.['codes']).toEqual([]);
  });

  it('keeps the US-Canada border exactly as Natural Earth draws it', () => {
    const out = litLandmasses(world, ALL);
    const lit = out.features.find((f) => f.properties?.['iso'] === 'US' && f.properties?.['lit'] === true);
    const g = lit?.geometry;
    const ring = g?.type === 'MultiPolygon' ? g.coordinates[0][0] : [];
    const border = ring.filter(([x, y]) => y > 48.5 && x < -95 && x > -125);
    expect(border.filter(([, y]) => y === 49).length).toBe(12);
    expect(border.some(([x, y]) => x === -95.16 && y === 49.38)).toBe(true); // Northwest Angle
  });

  /*
   * Splitting a country into its lit and unlit landmasses must move nothing.
   * Every polygon of the original feature has to come back, byte for byte,
   * across the two features - so what is on screen is the surveyed outline and
   * not something this module redrew.
   */
  it('re-cuts the United States without altering a single coordinate', () => {
    const out = litLandmasses(world, ALL);
    const source = world.features.find((f) => f.properties?.['iso'] === 'US');
    const original = source?.geometry.type === 'MultiPolygon' ? source.geometry.coordinates : [];
    const pieces = out.features
      .filter((f) => f.properties?.['iso'] === 'US')
      .flatMap((f) => (f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates : []));

    expect(pieces).toHaveLength(original.length);
    expect(JSON.stringify([...pieces].sort())).toBe(JSON.stringify([...original].sort()));
  });

  it('does not mutate the outlines react-query is caching', () => {
    const before = JSON.stringify(world.features[0]);
    litLandmasses(world, ALL);
    expect(JSON.stringify(world.features[0])).toBe(before);
  });
});
