import { useCallback, useEffect, useRef, useState } from 'react';
import { latLngBounds } from 'leaflet';
import { MapContainer, useMap } from 'react-leaflet';
import type { CompanySummary, TierPolicy } from '../../api/contract';
import { useConfig } from '../../config/AppContext';
import { useNow } from '../../domain/connectionState';
import { tierToken, siteToken } from '../../domain/status';
import { useI18n } from '../../i18n/I18nProvider';
import { usePrefs } from '../../state/prefsStore';
import { StatusIcon } from '../primitives/StatusIcon';
import { BaseGeoLayer } from './BaseGeoLayer';
import { MapControls } from './MapControls';
import { MapLabelLayer } from './MapLabelLayer';
import { RasterTileLayer } from './RasterTileLayer';

/**
 * The world map.
 *
 * react-leaflet rather than raw Leaflet, and for a specific reason: section 7
 * of the design doc lists "having to re-initialize Leaflet on every refresh" as
 * the first reason the Grafana approach was abandoned. Raw Leaflet inside React
 * 19 reproduces exactly that - StrictMode double-invokes effects and HMR
 * remounts, both of which produce "Map container is already initialized".
 * react-leaflet owns that lifecycle. Repeating the bug that killed the previous
 * approach would be an unusually avoidable mistake.
 */
export function WorldMap({
  companies,
  targetOa,
  tierPolicy,
  expanded,
  onToggleExpand,
}: {
  companies: CompanySummary[];
  targetOa: number;
  tierPolicy?: TierPolicy;
  /** Whether the board has given the map the whole width. Owned by the page. */
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const cfg = useConfig();
  const { t } = useI18n();
  const nowMs = useNow(30_000);
  const theme = usePrefs((s) => s.theme);
  const [tilesDown, setTilesDown] = useState(false);

  /*
   * The basemap is the one thing on the board a token cannot re-colour: it is
   * photographic raster, not CSS, so the dark theme needs a different *source*
   * rather than a different value. Hence `tileUrlDark` in runtime config.
   *
   * Falling back to the light tiles when a site has not set it is deliberate.
   * The alternative - drawing no raster at all in dark mode - would silently
   * take the coastlines and city names away from the layer a viewer is using to
   * place nine pins, which is a worse failure than a bright map. The bundled
   * Natural Earth outlines underneath are token-coloured either way.
   */
  const tileUrl = (theme === 'dark' ? cfg.tileUrlDark : null) ?? cfg.tileUrl;

  const good = tierPolicy?.good_at ?? targetOa - 5;
  const warn = tierPolicy?.warn_at ?? targetOa - 20;

  return (
    <div className="map-container">
      <MapContainer
        // The first frame only. FitToSites takes over as soon as the companies
        // arrive and the panel has a real size; this is what is on screen for
        // the frame in between.
        center={[22, 20]}
        zoom={2}
        minZoom={1}
        maxZoom={6}
        /*
         * Quarter-zoom steps. fitBounds picks the largest zoom that still fits,
         * so on the default whole-number snap a view that wants 2.25 renders at
         * 2 and throws away a fifth of the panel - which is a fifth of the room
         * the labels have to sit in. It also lets a pinch settle where the
         * fingers left it instead of jumping a whole level.
         */
        zoomSnap={0.25}
        /*
         * Leaflet's own zoom bar is off, but the buttons are not: MapControls
         * draws +, − and expand as real <button>s of its own - the zoom pair top
         * left, expand top right. See the comment there for why they are ours.
         */
        zoomControl={false}
        // Legal requirement, and the control is styled rather than hidden.
        attributionControl
        /*
         * The wheel zooms. It is the first thing a viewer reaches for on a map
         * this size, and the pinned +/- pair is a poor substitute once the
         * cursor is already over the pin they want a closer look at.
         *
         * The reason it used to be off - reading down the page must not
         * silently re-frame the map - is answered by WheelPassThrough below
         * rather than by giving the gesture up.
         */
        scrollWheelZoom
        /*
         * A notch is half a zoom level, not one and a quarter. Leaflet's
         * default is tuned for a street map with eighteen levels; this one has
         * five between minZoom and maxZoom, so on the default a single click of
         * the wheel takes the world view most of the way down to one country.
         * 200px/level lands on the quarter-steps zoomSnap already uses.
         */
        wheelPxPerZoomLevel={200}
        worldCopyJump
        style={{ height: '100%', width: '100%' }}
      >
        {/* Always present, so the map is never blank and never a grey checkerboard. */}
        <BaseGeoLayer />

        {tileUrl && !tilesDown ? (
          <RasterTileLayer
            url={tileUrl}
            attribution={cfg.tileAttribution}
            onUnavailable={() => setTilesDown(true)}
          />
        ) : null}

        <FitToContainer />
        <WheelPassThrough />
        <FitToSites companies={companies} />
        <MapControls expanded={expanded} onToggleExpand={onToggleExpand} />

        {/*
         * One layer, not nine markers. At world zoom the sites are not
         * separable - THS and ASI are 20 km apart, SUS and IIS about 200 - so
         * the cards have to be free to move away from their coordinates. The
         * placement pass that decides where each one goes lives in
         * MapLabelLayer; see the long comment there.
         */}
        <MapLabelLayer companies={companies} nowMs={nowMs} />
      </MapContainer>

      {/*
       * The design draws four coloured squares. They keep their four colours
       * here but each is the tier's own icon rather than a plain square,
       * because the swatch is also the key to the pins - and on this palette
       * red and amber sit at a deuteranope colour distance of roughly 2-6
       * against a usable floor of 6-8. Shape is what carries the mapping; the
       * colour reinforces it.
       */}
      <div className="map-legend">
        <span className="map-legend__item">
          <span className="glyph" style={{ color: tierToken('good').inkVar }}>
            <StatusIcon name={tierToken('good').icon} />
          </span>
          {t('kpi.oa.short')} ≥ {good}
        </span>
        <span className="map-legend__item">
          <span className="glyph" style={{ color: tierToken('warn').inkVar }}>
            <StatusIcon name={tierToken('warn').icon} />
          </span>
          {t('kpi.oa.short')} {warn}–{good - 1}
        </span>
        <span className="map-legend__item">
          <span className="glyph" style={{ color: tierToken('critical').inkVar }}>
            <StatusIcon name={tierToken('critical').icon} />
          </span>
          {t('kpi.oa.short')} &lt; {warn}
        </span>
        <span className="map-legend__item">
          <span className="glyph" style={{ color: siteToken('not_connected').inkVar }}>
            <StatusIcon name={siteToken('not_connected').icon} />
          </span>
          {t('map.legend.noData')}
        </span>
        {tilesDown || !tileUrl ? (
          <span className="map-legend__item map-legend__item--quiet">{t('map.offlineBasemap')}</span>
        ) : null}
      </div>
    </div>
  );
}

/**
 * Keeps Leaflet's idea of the viewport in step with the box it actually sits in.
 *
 * Leaflet only recomputes on `window.resize`. Now that the map is a flex child of
 * a fixed-height panel, its box also changes without the window moving at all -
 * a connection banner appearing, the density switch to kiosk, the ranking panel
 * reflowing. Miss those and the tiles keep the old size: grey bands down one
 * edge, and pins placed against stale pixel coordinates.
 */
function FitToContainer() {
  const map = useMap();

  useEffect(() => {
    const el = map.getContainer();
    const ro = new ResizeObserver(() => {
      // `false` - no animation. This fires during layout, and an animated pan
      // here reads as the board twitching every time a banner appears.
      map.invalidateSize(false);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [map]);

  return null;
}

/**
 * Gives the wheel back to the page once the map has nowhere left to zoom.
 *
 * Leaflet's scroll-wheel handler swallows every notch it sees - it calls
 * preventDefault on all of them, at minZoom as readily as anywhere else. That
 * is fine on a map that fills the window and wrong here: the map is a tall
 * panel with the ranking table under it, so a viewer scrolling down to reach
 * the table would zoom the world out to minZoom and then sit there, wheel
 * turning, page still. That is the behaviour the old scrollWheelZoom={false}
 * was avoiding, and it is worth avoiding - but the answer is a limit, not a ban.
 *
 * So: capture phase on the box *around* the Leaflet container, which runs
 * before Leaflet's own listener on the container inside it. While the map can
 * still move in the direction asked, this does nothing at all and Leaflet
 * zooms. At the limit it stops the event short of Leaflet - and, crucially,
 * never calls preventDefault - so the browser treats the notch as an ordinary
 * scroll and the page moves instead.
 */
function WheelPassThrough() {
  const map = useMap();

  useEffect(() => {
    // The Leaflet container's parent is the .map-container box; the fallback is
    // only for the frame before it is in the document.
    const el = map.getContainer().parentElement ?? map.getContainer();

    const onWheel = (e: WheelEvent) => {
      // A trackpad's sideways flick carries no deltaY, and Leaflet reads deltaY
      // only - there is nothing here to arbitrate.
      if (e.deltaY === 0) return;

      const zoom = map.getZoom();
      const stuck = e.deltaY > 0 ? zoom <= map.getMinZoom() : zoom >= map.getMaxZoom();
      if (stuck) e.stopPropagation();
    };

    el.addEventListener('wheel', onWheel, { capture: true });
    return () => el.removeEventListener('wheel', onWheel, { capture: true });
  }, [map]);

  return null;
}

/**
 * Frames the view on the sites rather than on a fixed centre and zoom.
 *
 * The hardcoded `center=[25, 10] zoom=2` is why the eastern labels ended up
 * stacked in a column against the right-hand edge, over the Pacific, with their
 * leaders pointing off the map. That was not a label bug. The bases span 241°
 * of longitude - SMX at -101.9 to STJ at +139.2 - and at zoom 2 that is 685px
 * of tiles before a single card is drawn, so on any panel narrower than that
 * Japan was not on screen at all. The placement pass then did the only thing
 * left to it and clamped STJ, VNS, ISE and the Thai pair against the edge.
 *
 * No seed-offset tuning fixes a site that is off the map, so the fit comes
 * first: every coordinate inside the viewport, with a margin wide enough for a
 * card to sit beside the outermost ones.
 *
 * It then gets out of the way. A pan or a pinch sets `touched` and nothing
 * re-frames after that - a board that snapped back to the world view on the
 * next 30-second poll would be unusable. The flag resets only when the set of
 * sites itself changes, because that is a different map.
 */
function FitToSites({ companies }: { companies: CompanySummary[] }) {
  const map = useMap();
  const touched = useRef(false);
  const fitting = useRef(false);
  const framed = useRef<string | null>(null);

  const fit = useCallback(() => {
    const points = companies
      .filter((c) => Number.isFinite(c.lat) && Number.isFinite(c.lng))
      .map((c) => [c.lat, c.lng] as [number, number]);
    if (points.length === 0) return;

    // The map lives in a tabpanel, and an unselected one is `display: none`.
    // Fitting against a 0x0 box lands on minZoom somewhere in the Atlantic; the
    // ResizeObserver below fires again the moment the tab is shown.
    const size = map.getSize();
    if (size.x === 0 || size.y === 0) return;

    const key = points
      .map(([lat, lng]) => `${lat},${lng}`)
      .sort()
      .join('|');
    if (key !== framed.current) touched.current = false;
    else if (touched.current) return;
    framed.current = key;

    /*
     * Padding is label room, not decoration. The outermost sites need roughly
     * half a card beside them or the placement pass opens by clamping again -
     * but a fixed 100px would eat a third of a narrow panel, so it scales with
     * the box and is capped at both ends. The extra at the bottom is the tier
     * legend and the attribution, both of which sit inside the map.
     */
    const padX = Math.min(56, Math.max(20, Math.round(size.x * 0.06)));
    const padY = Math.min(40, Math.max(16, Math.round(size.y * 0.07)));

    fitting.current = true;
    map.fitBounds(latLngBounds(points), {
      paddingTopLeft: [padX, padY],
      paddingBottomRight: [padX, padY + 16],
      // Otherwise nine sites on one continent would fit at street level.
      maxZoom: 5,
      // This runs during layout; an animated fly-to reads as the board
      // twitching every time a banner appears or the density switches.
      animate: false,
    });
    fitting.current = false;
  }, [map, companies]);

  useEffect(() => {
    // `dragstart`/`zoomstart` are the two events a human generates - and that
    // the fit generates too, hence the guard. Without it the map's own
    // fitBounds would mark the view as user-owned and the first real resize
    // would never re-frame.
    const mark = () => {
      if (!fitting.current) touched.current = true;
    };
    map.on('dragstart zoomstart', mark);
    return () => {
      map.off('dragstart zoomstart', mark);
    };
  }, [map]);

  useEffect(() => {
    fit();
    const ro = new ResizeObserver(() => fit());
    ro.observe(map.getContainer());
    return () => ro.disconnect();
  }, [map, fit]);

  return null;
}
