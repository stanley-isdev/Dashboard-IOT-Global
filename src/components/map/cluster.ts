/**
 * Which dots have landed on top of each other, and how much room they take up.
 *
 * ## Why this exists
 *
 * Two of the nine bases cannot be separated on this map at any zoom the map
 * offers. THS and ASI are 20 km apart; measured across three viewport sizes,
 * their dots sit 0.0-1.4 px apart at the opening fit and are still only 4-6 px
 * apart at maxZoom 6. So "zoom in to tell them apart" is not advice this board
 * can give - the dot at that coordinate is, permanently, two bases.
 *
 * What the map used to do about that was nothing, and the result was a dot that
 * quietly wore whichever tier happened to be later in the payload. It showed
 * ASI's critical red and never once said that THS was also there. That is the
 * board stating something false with total confidence, which is the only kind of
 * wrong a dashboard is not allowed to be.
 *
 * ## What is deliberately *not* done here
 *
 * Nothing moves. The usual fix for overlapping markers - spiderfying, jitter,
 * snapping the group to a shared centre - buys legibility by putting pins where
 * the sites are not, and the coordinates on this map were checked against the
 * surveyed figures to the last decimal. A pin nudged 6 px for legibility is a
 * pin that is 14 km wrong at zoom 6, and nothing on screen would admit it.
 *
 * So the dots stay exactly where they are and a count is set beside them. The
 * count is the one fact a single dot cannot carry: *how many bases are under
 * it*. What state each of them is in is already on the two cards - colour, glyph
 * and word - with a leader line from each card back to this point, so the badge
 * does not try to repeat it.
 *
 * An earlier version drew a ring around the group as well, split into one arc
 * per member in that member's tier colour. It was accurate and it was clutter:
 * a 22px ring of furniture permanently parked on the one part of the map that
 * already has two cards, two leaders and a pulsing alert converging on it. The
 * badge says the same thing in the space of two characters.
 *
 * ## Pure functions, and a test rather than an eyeball
 *
 * The grouping is geometry over container pixels, so it can be checked without a
 * browser - see cluster.test.ts. The layer above it does the DOM.
 */

/** A dot's centre in Leaflet container pixels. */
export interface DotPoint {
  code: string;
  x: number;
  y: number;
}

export interface Cluster {
  /**
   * Stable identity: member codes, sorted, joined. Used as the React key and as
   * the signature that decides whether the grouping has actually changed - the
   * layout pass runs on every frame of a pan, and re-rendering the layer sixty
   * times a second because a centroid moved two pixels is not something the
   * placement pass would survive.
   */
  key: string;
  /** Member codes, sorted, so nothing depends on payload order. */
  codes: string[];
}

/**
 * Group dots whose fills overlap.
 *
 * `diameter` is the dot's own rendered width, measured off the DOM by the caller
 * rather than declared here. Two dots overlap exactly when their centres are
 * closer than one diameter, so the threshold is not a tuned number - it is the
 * definition of the thing being detected, and it follows the dot if the kiosk
 * density switch scales it.
 *
 * Single linkage, so overlap is transitive: A overlapping B and B overlapping C
 * is one group of three, even where A and C do not touch. The alternative -
 * pairwise groups - would put two badges on the same pile.
 *
 * Groups of one are not returned. A lone dot is not lying about anything and
 * needs no count.
 */
export function groupOverlapping(points: DotPoint[], diameter: number): Cluster[] {
  const taken = new Set<number>();
  const clusters: Cluster[] = [];

  for (let i = 0; i < points.length; i++) {
    if (taken.has(i)) continue;
    taken.add(i);
    const members = [i];

    // Grows while it walks: anything pulled in is itself checked for neighbours,
    // which is what makes the linkage transitive.
    for (let m = 0; m < members.length; m++) {
      for (let j = 0; j < points.length; j++) {
        if (taken.has(j)) continue;
        const a = points[members[m]];
        const b = points[j];
        if (Math.hypot(a.x - b.x, a.y - b.y) < diameter) {
          taken.add(j);
          members.push(j);
        }
      }
    }

    if (members.length < 2) continue;
    const codes = members.map((k) => points[k].code).sort();
    clusters.push({ key: codes.join('+'), codes });
  }

  // Sorted so the signature is a function of the grouping alone, never of the
  // order the payload happened to arrive in.
  return clusters.sort((a, b) => a.key.localeCompare(b.key));
}

/** The circle a cluster's dots occupy, in container pixels. */
export interface ClusterFootprint {
  cx: number;
  cy: number;
  /** Outer radius: clears every member's dot, plus the gap it was given. */
  r: number;
}

/**
 * How much space the pile takes up, which is what the count badge is hung off.
 *
 * The badge sits at the top-right corner of this box rather than on the dots,
 * so the box has to clear the outermost dot in the group - otherwise a count
 * parks on the very coordinate it is annotating.
 *
 * Centred on the mean rather than on any member: for the pair this was built for
 * the two are within a pixel of each other and the distinction is academic, but
 * a group of three strung out over eight pixels would otherwise hang its badge
 * off one member and read as belonging to that one.
 */
export function clusterFootprint(
  points: DotPoint[],
  diameter: number,
  gap: number,
): ClusterFootprint {
  const cx = points.reduce((s, p) => s + p.x, 0) / points.length;
  const cy = points.reduce((s, p) => s + p.y, 0) / points.length;
  const reach = Math.max(...points.map((p) => Math.hypot(p.x - cx, p.y - cy)));
  return { cx, cy, r: reach + diameter / 2 + gap };
}
