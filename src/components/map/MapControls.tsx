import { useCallback, useEffect, useState } from 'react';
import { DomEvent } from 'leaflet';
import { useMap } from 'react-leaflet';
import { useI18n } from '../../i18n/I18nProvider';

/**
 * Zoom in and zoom out top left, expand top right.
 *
 * Not Leaflet's own `zoomControl`. Two reasons, and the second is the real one:
 *
 * Leaflet's control is an `<a href="#">` pair carrying "+" and "−" as text
 * nodes, styled by a stylesheet this theme then has to fight. Ours are real
 * `<button>`s with SVG glyphs and the app's own focus ring, and they can be
 * disabled at the zoom limits - Leaflet's only greys its links, which on a
 * touchscreen is a button that looks pressable and does nothing.
 *
 * Expand is drawn from here so it matches the zoom pair - same box, same
 * border, same shadow - but it sits in the opposite corner, because it is the
 * board's action rather than the map's: it resizes the panel the map lives in.
 * Stacked under ± it read as a third zoom step, and it crowded the one corner
 * the westmost labels want. Top right is where a viewer already looks for a
 * window control. It arrives as a prop, so that corner renders nothing at all
 * when nobody is listening.
 *
 * Both stacks live inside the Leaflet container, so every event they see is an
 * event the map would otherwise act on - a double-click on "+" would zoom
 * twice, a scroll over a stack would pan. `DomEvent` stops both at the
 * boundary.
 */
export function MapControls({
  expanded,
  onToggleExpand,
}: {
  expanded?: boolean;
  onToggleExpand?: () => void;
}) {
  const map = useMap();
  const { t } = useI18n();

  /*
   * `zoom` is mirrored into state for one reason: the buttons have to disable
   * themselves at the limits, and Leaflet does not re-render React when the
   * zoom changes. `zoomend` rather than `zoom` - the intermediate values of an
   * animated zoom would flicker the disabled state on the way past a limit.
   */
  const [zoom, setZoom] = useState(() => map.getZoom());
  useEffect(() => {
    const sync = () => setZoom(map.getZoom());
    map.on('zoomend', sync);
    return () => {
      map.off('zoomend', sync);
    };
  }, [map]);

  /* Both corners get the same guard, so it is a callback ref and not a stored
     one - nothing here needs to read the element back afterwards. */
  const attach = useCallback((el: HTMLDivElement | null) => {
    if (!el) return;
    DomEvent.disableClickPropagation(el);
    DomEvent.disableScrollPropagation(el);
  }, []);

  const atMax = zoom >= map.getMaxZoom();
  const atMin = zoom <= map.getMinZoom();

  return (
    <>
      <div className="map-controls" ref={attach}>
        <button
          type="button"
          className="map-btn"
          onClick={() => map.zoomIn()}
          disabled={atMax}
          aria-label={t('map.zoomIn')}
          title={t('map.zoomIn')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M8 3.75v8.5M3.75 8h8.5" />
          </svg>
        </button>

        <button
          type="button"
          className="map-btn"
          onClick={() => map.zoomOut()}
          disabled={atMin}
          aria-label={t('map.zoomOut')}
          title={t('map.zoomOut')}
        >
          <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
            <path d="M3.75 8h8.5" />
          </svg>
        </button>
      </div>

      {/*
        A second pinned stack rather than one row spanning the map's width: the
        corners are positioned independently, and a single element wide enough
        to reach both would be a transparent bar over the countries between
        them, eating clicks the map should have had.
      */}
      {onToggleExpand ? (
        <div className="map-controls map-controls--right" ref={attach}>
          <button
            type="button"
            className="map-btn"
            onClick={onToggleExpand}
            /*
             * `aria-pressed` and not just a changing label: this is a toggle that
             * stays down, and a screen reader user who tabs back to it later
             * needs to know which way it is set without inferring it from the
             * word on the tooltip.
             */
            aria-pressed={!!expanded}
            aria-label={t(expanded ? 'map.collapse' : 'map.expand')}
            title={t(expanded ? 'map.collapse' : 'map.expand')}
          >
            {expanded ? (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M6.5 2.5v4h-4M9.5 13.5v-4h4M6.5 6.5l-4-4M9.5 9.5l4 4" />
              </svg>
            ) : (
              <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true">
                <path d="M2.5 6.5v-4h4M13.5 9.5v4h-4M2.5 2.5l4 4M13.5 13.5l-4-4" />
              </svg>
            )}
          </button>
        </div>
      ) : null}
    </>
  );
}
