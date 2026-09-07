import type { Feature, FeatureCollection, Position } from 'geojson';

/**
 * Which landmasses the estate actually sits on.
 *
 * ## Why this is not simply "the country is orange"
 *
 * It was, for one revision, and Alaska is the reason it is not. Natural Earth
 * ships the United States as one feature holding ten polygons - the lower 48,
 * five Hawaiian islands, and four pieces of Alaska - so a fill keyed on the
 * country code painted a landmass the size of Western Europe, in the Arctic,
 * eight thousand kilometres from the nearest Stanley base, in the same orange
 * that everywhere else on this board means "ours". A viewer's eye goes to the
 * biggest orange shape on the map, and on a world view that shape was the one
 * place with nothing in it.
 *
 * So the unit of highlighting is the landmass a base stands on, not the country
 * it is administered from. SUS and IIS light the lower 48 and leave Alaska and
 * Hawaii in the basemap's grey; ISE lights Java and leaves the other twelve
 * pieces of Indonesia alone; STJ lights the Japanese main island and not
 * Hokkaido. The rule is the one a reader would state looking at the result:
 * orange is the ground our bases are on.
 *
 * ## The fallback, which matters more than the test does
 *
 * The bundled outlines are 1:110m - a coastline generalised to a few hundred
 * vertices - so a base on a river mouth or a reclaimed industrial estate can
 * genuinely fall a kilometre outside its own country's polygon. Treating a miss
 * as "not on land" would silently drop that country off the map, which is the
 * one failure this must not have: a base that exists and is not shown.
 *
 * A miss therefore falls back to the nearest polygon of the same country rather
 * than to nothing. The country code is what scopes the search, so a coordinate
 * off the Thai coast can only ever light Thailand - never a neighbour that
 * happens to be closer.
 *
 * Pure geometry over the fetched outlines, so it is checked in litLand.test.ts
 * against the real file and the real coordinates rather than by eye.
 */

/** The identity a site needs to be placed. `CompanySummary` satisfies it. */
export interface SitePoint {
  country_code: string;
  lat: number;
  lng: number;
  /**
   * Which base this is, carried through onto the ground it lights.
   *
   * Optional only for the geometry tests, which name a point by the country it
   * belongs to and never read the tag back. Every caller in the app has a base
   * code to hand - both `CompanySummary` and `CompanyMeta` carry one - and the
   * layer needs it, because the tag is what lets a filter change be a restyle
   * rather than a re-cut. See `LitProps.codes`.
   */
  code?: string;
}

/** What `BaseGeoLayer` styles on. Set on every feature this returns. */
export interface LitProps {
  /** Whether a base in the set this was cut against stands on this ground. */
  lit: boolean;
  /**
   * The bases standing on it, and empty on everything else.
   *
   * This is why the cut is worth keeping: the layer cuts once against the fleet
   * as commissioned and then decides orange from `codes` against whatever the
   * region filter currently has ticked. Without it, "which ground is ours" was a
   * property of the geometry, so narrowing the filter meant re-cutting the world
   * and rebuilding every country path in Leaflet - about a fifth of a second of
   * blocked main thread per tick, on a control people tick four times in a row.
   */
  codes: string[];
}

/**
 * Ray casting, in GeoJSON's own [lng, lat] order.
 *
 * A ring is closed, so the first-to-last edge is walked like any other via the
 * `j` lag. Points exactly on an edge are undefined either way and it does not
 * matter here: a surveyed factory coordinate does not land on a 110m coastline
 * vertex, and if one did, both answers light the same country.
 */
function inRing(lng: number, lat: number, ring: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

/** Outer ring minus any holes - the Caspian, Lesotho, an inland lake. */
function inPolygon(lng: number, lat: number, rings: Position[][]): boolean {
  if (rings.length === 0 || !inRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) {
    if (inRing(lng, lat, rings[h])) return false;
  }
  return true;
}

/**
 * How far the point is from a polygon's outline, near enough for a comparison.
 *
 * Vertex distance rather than distance to the edge, and squared degrees with
 * longitude scaled by latitude rather than metres: this exists only to rank one
 * polygon of a country against the others when the point missed all of them, and
 * at that job the two agree. Nothing downstream reads the number.
 */
function roughDistanceSq(lng: number, lat: number, rings: Position[][]): number {
  const kx = Math.cos((lat * Math.PI) / 180);
  let best = Infinity;
  for (const [x, y] of rings[0] ?? []) {
    const dx = (x - lng) * kx;
    const dy = y - lat;
    const d = dx * dx + dy * dy;
    if (d < best) best = d;
  }
  return best;
}

/** A feature's polygons, with a Polygon treated as a MultiPolygon of one. */
function polygonsOf(feature: Feature): Position[][][] {
  const g = feature.geometry;
  if (g.type === 'Polygon') return [g.coordinates];
  if (g.type === 'MultiPolygon') return g.coordinates;
  return [];
}

/** Index of the polygon a site stands on, or the nearest one if it stands on none. */
function landmassFor(site: SitePoint, polygons: Position[][][]): number {
  for (let i = 0; i < polygons.length; i++) {
    if (inPolygon(site.lng, site.lat, polygons[i])) return i;
  }

  let best = -1;
  let bestD = Infinity;
  for (let i = 0; i < polygons.length; i++) {
    const d = roughDistanceSq(site.lng, site.lat, polygons[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * The basemap, re-cut so the lit landmasses can be styled apart from the rest.
 *
 * Leaflet styles a feature, not a polygon, so a country that is only partly lit
 * comes back as more than one feature over the same `iso` - one per landmass
 * with bases on it, and one for everything else. Countries with no base, and
 * countries lit in full by a single landmass, stay one feature each; the input
 * is never mutated, since react-query hands out the same parsed object to every
 * caller and keeps it for the session.
 *
 * Cut against the whole fleet rather than against the current filter. The result
 * is the same geometry whatever is ticked, which is the point: the layer mounts
 * it once and answers a filter change with `setStyle` over the `codes` tags
 * instead of a remount. Two bases on the same landmass share its feature and
 * both appear in its `codes`, so unticking one of them leaves the ground lit -
 * which is correct, and is a question the old boolean could not be asked.
 */
export function litLandmasses(
  data: FeatureCollection,
  sites: readonly SitePoint[],
): FeatureCollection<Feature['geometry'], LitProps & Record<string, unknown>> {
  const byCountry = new Map<string, SitePoint[]>();
  for (const s of sites) {
    if (!s.country_code || !Number.isFinite(s.lat) || !Number.isFinite(s.lng)) continue;
    const list = byCountry.get(s.country_code);
    if (list) list.push(s);
    else byCountry.set(s.country_code, [s]);
  }

  const out: Feature[] = [];

  for (const feature of data.features) {
    const iso = feature.properties?.['iso'];
    const here = typeof iso === 'string' ? byCountry.get(iso) : undefined;
    const props = { ...feature.properties };

    if (!here || here.length === 0) {
      out.push({ ...feature, properties: { ...props, lit: false, codes: [] } });
      continue;
    }

    const polygons = polygonsOf(feature);
    /* Landmass index -> the bases standing on it. */
    const lit = new Map<number, string[]>();
    for (const site of here) {
      const i = landmassFor(site, polygons);
      if (i < 0) continue;
      const codes = lit.get(i);
      if (codes) codes.push(site.code ?? site.country_code);
      else lit.set(i, [site.code ?? site.country_code]);
    }

    if (lit.size === 0) {
      out.push({ ...feature, properties: { ...props, lit: false, codes: [] } });
      continue;
    }
    if (lit.size === 1 && polygons.length === 1) {
      out.push({ ...feature, properties: { ...props, lit: true, codes: lit.get(0) ?? [] } });
      continue;
    }

    /* One feature per occupied landmass, so each carries its own bases... */
    for (const [i, codes] of lit) {
      out.push({
        type: 'Feature',
        properties: { ...props, lit: true, codes },
        geometry: { type: 'MultiPolygon', coordinates: [polygons[i]] },
      });
    }
    /* ...and one for the rest of the country, which no filter can light. */
    const off: Position[][][] = polygons.filter((_, i) => !lit.has(i));
    if (off.length > 0) {
      out.push({
        type: 'Feature',
        properties: { ...props, lit: false, codes: [] },
        geometry: { type: 'MultiPolygon', coordinates: off },
      });
    }
  }

  return { type: 'FeatureCollection', features: out } as FeatureCollection<
    Feature['geometry'],
    LitProps & Record<string, unknown>
  >;
}
