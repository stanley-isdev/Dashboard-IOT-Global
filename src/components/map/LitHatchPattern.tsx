/**
 * The hatch the lit landmasses are filled with.
 *
 * ## Why a pattern and not a colour
 *
 * The lit ground used to be `--accent-fill` flat, and it worked - too well. At
 * world zoom a country is the largest shape on the panel, and painting it in
 * the same undimmed orange as the Export button and the on-state filter capsule
 * made the ground the loudest thing on the board. The eye went to Thailand
 * before it went to the pin on Thailand, which is backwards: the fill answers
 * "where is the estate", the pins answer "how is it doing", and only the second
 * of those changes minute to minute.
 *
 * So the ground steps back. A pastel wash carries the hue and a 45-degree
 * hairline rule carries the texture, which together still read as "ours" from
 * across a room while sitting a clear level below the pins in weight.
 *
 * ## Why it is an SVG pattern rather than a CSS one
 *
 * Leaflet draws countries as `<path>` elements in an SVG overlay pane, and an
 * SVG shape cannot take a CSS `background-image` - `fill` is the only hook
 * there is. `fill="url(#id)"` is a valid presentation attribute, so this is a
 * drop-in for the colour that used to be in `fillColor` and, crucially, one
 * that `setStyle` can write: a `className` cannot, since Leaflet only applies
 * class names when it first builds a path and never on a restyle. That is what
 * keeps a region tick an attribute write instead of a remount - see the long
 * comment in BaseGeoLayer.
 *
 * The tile is in user space, which for Leaflet's overlay pane is screen pixels
 * at the current zoom, so the rule stays a hairline at every zoom and pans with
 * the land under it rather than sitting still behind a moving map.
 *
 * Both colours are tokens read off `:root`, so the pattern follows the theme
 * switch with everything else and needs no dark-mode branch here.
 */

/** What `BaseGeoLayer` puts in `fillColor`. One place, so the id has one home. */
export const LIT_HATCH_FILL = 'url(#map-lit-hatch)';

/**
 * Zero-size and out of the layout - this renders nothing itself. It exists so
 * the pattern is somewhere in the document for the paths to point at, and it
 * lives beside the map rather than in the app shell because the map is the only
 * thing that references it.
 */
export function LitHatchPattern() {
  return (
    <svg
      width="0"
      height="0"
      aria-hidden="true"
      focusable="false"
      style={{ position: 'absolute' }}
    >
      <defs>
        {/*
         * A 6px tile ruled once. `patternTransform` turns the whole lattice
         * rather than the line inside the tile, which is what keeps the rules
         * continuous across tile edges; the half of the stroke that overhangs
         * x=0 is completed by the neighbouring tile's, so the seam does not
         * show. 1.1 on 6 is roughly a fifth ink - enough to read as texture at
         * the size of Java, light enough that Thailand does not turn solid.
         */}
        <pattern
          id="map-lit-hatch"
          width="6"
          height="6"
          patternUnits="userSpaceOnUse"
          patternTransform="rotate(45)"
        >
          {/* The wash. Opaque, because the raster tiles are underneath this. */}
          <rect width="6" height="6" fill="var(--map-lit-ground)" />
          <line
            x1="0"
            y1="0"
            x2="0"
            y2="6"
            stroke="var(--map-lit-hatch)"
            strokeWidth="1.1"
            strokeLinecap="square"
          />
        </pattern>
      </defs>
    </svg>
  );
}
