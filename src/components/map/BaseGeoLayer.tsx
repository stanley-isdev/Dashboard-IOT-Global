import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { GeoJSON } from 'react-leaflet';
import type { GeoJSON as GeoJsonLayer, PathOptions } from 'leaflet';
import type { Feature, FeatureCollection } from 'geojson';
import { useMeta } from '../../api/queries';
import { LIT_HATCH_FILL } from './LitHatchPattern';
import { litLandmasses, type SitePoint } from './litLand';

/**
 * Country outlines from Natural Earth, bundled with the app.
 *
 * This is the base layer, not a fallback. Two reasons.
 *
 * The first is legal and practical: T-12 requires the dashboard to work on a
 * plant network with no public internet, and CARTO's tiles come from their CDN.
 * Bulk-downloading those tiles to self-host would breach CARTO's terms, so
 * "self-host the basemap" was never actually available. Natural Earth is public
 * domain, needs no attribution and has no terms to breach.
 *
 * The second is that at the zoom this map uses - nine pins on a world view - a
 * raster basemap is drawing city labels, roads and terrain that nothing here
 * needs. They compete with the pins for attention. Outlines read better.
 *
 * Fetched from public/ rather than bundled so ops can drop in the higher
 * resolution 1:50m file without a rebuild.
 */

/*
 * Land, and the border around it.
 *
 * The stroke is a real border rather than a tidying outline - see --map-border
 * in tokens.css for why it stopped being --line-strong. 0.9px is the weight at
 * which the Franco-German boundary is visible at world zoom without Europe
 * turning into a mesh; Leaflet does not scale it with zoom, so it is the same
 * hairline whether the view holds nine countries or one.
 */
const STYLE = {
  fillColor: 'var(--panel-2)',
  fillOpacity: 1,
  color: 'var(--map-border)',
  weight: 0.9,
  interactive: false,
} as const;

/*
 * The land a Stanley base stands on: a pastel wash, ruled at 45 degrees.
 *
 * It answers a question the pins alone cannot - where the estate is at all.
 * Nine cards clamped around the Pacific rim do not say "seven countries"; land
 * with a texture on it does, at a glance and from across a room.
 *
 * It was --accent-fill flat, the same undimmed orange as the Export button, and
 * the trouble with that was how well it worked: a country is the largest shape
 * on the panel, so the ground ended up outweighing the pins standing on it. The
 * hatch keeps the hue and gives up the weight. See LitHatchPattern for why the
 * texture has to arrive through `fill` rather than a class, and why the wash
 * inside it stays opaque.
 *
 * The pins survive sitting on it either way. Every dot carries a 2px --pin-halo
 * ring and every card its own --panel ground, which is what keeps a red dot
 * separable from the ground under it.
 *
 * Which land counts is litLand.ts, and it is a landmass rather than a country
 * for a reason worth reading before changing it.
 */
const HIGHLIGHT = {
  ...STYLE,
  fillColor: LIT_HATCH_FILL,
  /*
   * A step heavier than the grey border and inked to be seen on the wash. This
   * is the line that has to carry the 49th parallel: the boundary a lit country
   * shares with an unlit one is the one place on the map where a real border
   * and the edge of a fill coincide, and only a drawn line tells a reader which
   * of the two they are looking at. With the fill now a pastel it is doing more
   * of that work than it used to, which is why the token behind it moved off
   * the deep brown a full-strength orange needed.
   */
  color: 'var(--map-border-lit)',
  weight: 1.1,
} as const;

/**
 * ## Why the cut and the colour are two different things
 *
 * They used to be one, and it was the board's worst stutter.
 *
 * `litLandmasses` was called with the payload's companies - which is the list
 * *after* the region filter - and the result was keyed into `<GeoJSON>`. So
 * ticking one base off changed the key, and Leaflet threw away every country
 * layer it had built and re-projected the whole 110m world to build them again.
 * Measured on the fleet board that is a fifth of a second of blocked main
 * thread, and the region menu stays open while it is ticked: four bases in a row
 * is four of them, on top of the refetch each tick already costs.
 *
 * The cut is now made against `/api/v1/meta` - the fleet as commissioned, which
 * does not move - so the geometry is the same whatever is ticked, mounts once,
 * and survives every filter change. Which of those pieces are orange is decided
 * from the `codes` each one carries against what is currently on the board, and
 * a change to that is a `setStyle` over layers that already exist: attribute
 * writes, no projection, no rebuild.
 *
 * Until meta lands the cut falls back to `sites`, so the first paint is right
 * rather than grey; that swap is the one remount left, and it happens once a
 * session.
 */
export function BaseGeoLayer({
  /** The bases to light the ground under. Empty leaves the map entirely grey. */
  sites,
}: {
  sites?: readonly SitePoint[];
}) {
  const { data } = useQuery({
    queryKey: ['basemap-geo'],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${import.meta.env.BASE_URL}geo/world-110m.geo.json`, { signal });
      if (!res.ok) throw new Error(`basemap ${res.status}`);
      return (await res.json()) as FeatureCollection;
    },
    // Country borders do not move. Fetch once, keep forever.
    staleTime: Infinity,
    gcTime: Infinity,
    retry: 1,
  });

  const meta = useMeta();

  /*
   * The set the geometry is cut against: every commissioned base, filter or no
   * filter. `sites` is only the fallback for the frame before meta lands.
   */
  const fleet = useMemo<readonly SitePoint[]>(
    () => meta.data?.companies ?? sites ?? [],
    [meta.data, sites],
  );

  /*
   * Keyed on the coordinates rather than on the array, because meta and the
   * payload both arrive as fresh objects. Nine point-in-polygon tests are cheap;
   * re-cutting the whole basemap, and remounting the vector layer under it, is
   * not - so this string is what has to change before either happens, and from
   * meta it changes when a site is commissioned and never on a poll.
   */
  const cutSig = (fleet as readonly SitePoint[])
    .map((s) => `${s.code ?? s.country_code}@${s.country_code}:${s.lat},${s.lng}`)
    .sort()
    .join('|');

  const shaded = useMemo(
    () => (data ? litLandmasses(data, fleet) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `cutSig` is what `fleet` means here.
    [data, cutSig],
  );

  /* The bases on the board right now - what the region filter left behind. */
  const litSig = (sites ?? [])
    .map((s) => s.code ?? s.country_code)
    .sort()
    .join(',');

  /* Rebuilt from the signature, so the dependency is a string and not an array
     identity that moves on every poll. */
  const on = useMemo(() => new Set(litSig ? litSig.split(',') : []), [litSig]);

  const styleFor = useCallback(
    (f?: Feature): PathOptions => {
      const codes = f?.properties?.['codes'];
      const lit = Array.isArray(codes) && codes.some((c: unknown) => on.has(String(c)));
      return lit ? HIGHLIGHT : STYLE;
    },
    [on],
  );

  /*
   * react-leaflet builds the vector layers once and does not re-run `style`
   * when the prop changes, so the update has to be asked for. `setStyle` walks
   * the layers it already has and writes their fill and stroke - which is the
   * whole saving here, since the alternative was the remount this component's
   * comment above is about.
   */
  const layer = useRef<GeoJsonLayer | null>(null);
  useEffect(() => {
    layer.current?.setStyle(styleFor);
  }, [styleFor, shaded]);

  if (!shaded) return null;

  return (
    <GeoJSON
      /*
       * The geometry, and only the geometry. It is cut against the fleet, so a
       * region tick does not touch this and the layers stay where they are.
       */
      key={cutSig}
      ref={layer}
      data={shaded}
      style={styleFor}
    />
  );
}
