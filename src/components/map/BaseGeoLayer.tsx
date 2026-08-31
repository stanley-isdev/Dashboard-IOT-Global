import { useQuery } from '@tanstack/react-query';
import { GeoJSON } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';

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

const STYLE = {
  fillColor: 'var(--panel-2)',
  fillOpacity: 1,
  color: 'var(--line-strong)',
  weight: 0.6,
  interactive: false,
} as const;

export function BaseGeoLayer() {
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

  if (!data) return null;
  return <GeoJSON data={data} style={() => STYLE} />;
}
