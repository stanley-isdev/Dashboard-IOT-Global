import { useState } from 'react';
import { TileLayer } from 'react-leaflet';

/**
 * The optional raster basemap, layered over the bundled vector outlines.
 *
 * If the tiles cannot be reached - an air-gapped plant, a firewall rule, CARTO
 * having a bad day - this layer removes itself after a few consecutive failures
 * and the vector layer underneath simply becomes the map. That is the whole
 * point of having a base beneath it: the failure mode is "less detail", not the
 * grey checkerboard Leaflet shows when a tile source dies.
 *
 * The URL and its attribution both come from runtime config, so an offline site
 * sets `tileUrl: null` and a site that switches providers changes one file. The
 * attribution string travels with the URL because a hardcoded credit is wrong
 * the moment the provider changes.
 */

const FAILURE_LIMIT = 8;

export function RasterTileLayer({
  url,
  attribution,
  onUnavailable,
}: {
  url: string;
  attribution: string;
  onUnavailable: () => void;
}) {
  const [failures, setFailures] = useState(0);
  const [gaveUp, setGaveUp] = useState(false);

  if (gaveUp) return null;

  return (
    <TileLayer
      url={url}
      attribution={attribution}
      maxZoom={19}
      eventHandlers={{
        tileerror: () => {
          setFailures((n) => {
            const next = n + 1;
            if (next >= FAILURE_LIMIT) {
              setGaveUp(true);
              onUnavailable();
            }
            return next;
          });
        },
        tileload: () => {
          if (failures > 0) setFailures(0);
        },
      }}
    />
  );
}
