import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { DomEvent, type Map as LeafletMap } from 'leaflet';
import { useMap } from 'react-leaflet';
import type { CompanySummary } from '../../api/contract';
import { isReporting } from '../../domain/status';
import { type Cluster, clusterFootprint, groupOverlapping } from './cluster';
import { CompanyPin } from './CompanyPin';
import { PinCluster } from './PinCluster';

/**
 * The label layer: nine offset cards, each joined to its coordinate by a leader
 * line, none of them overlapping each other or the map's own chrome.
 *
 * ## Why this is not nine Leaflet markers
 *
 * Because at world zoom the sites are not separable. THS and ASI are 20 km
 * apart, SUS and IIS about 200 km; on a 700px-wide world map those pairs land
 * within four pixels of each other. Anything anchored *at* the coordinate - a
 * marker, a permanent tooltip, a popup - therefore overlaps, and Leaflet has no
 * opinion about that. The card has to be free to move away from its site, which
 * means something has to decide where it goes, which is the pass below.
 *
 * The layer is one absolutely-positioned div portalled into the map container, so
 * every card is an ordinary React element in an ordinary DOM tree. That is what
 * lets a card be a focusable <Link> instead of a decorative tooltip beside an
 * invisible marker, and it means the leader geometry is a subtraction rather than
 * a fight with Leaflet's transform on the tooltip pane.
 *
 * ## The placement pass
 *
 * Runs on every `move`, `zoom` and `resize`, plus once after the initial fit.
 * `move` rather than the design's `moveend`: labels that only catch up when the
 * pan finishes visibly slide off their sites for the duration of the drag.
 *
 *   1. seed each card at a hand-tuned offset from its coordinate;
 *   2. flip the offset inward when it would leave the viewport;
 *   3. clamp the card's centre inside the viewport;
 *   4. push it clear of the map's chrome - the zoom and expand buttons, the tier
 *      legend, the attribution - whose boxes are measured, not declared;
 *   5. separate it from every card already placed, re-checking step 4 each pass;
 *   6. write the card's offset, then derive the leader's length and angle from
 *      where the card actually ended up.
 *
 * Steps 2-5 are geometry over measured DOM boxes, so they hold at any panel size
 * and in either language - Thai codes are wider than Latin ones and the cards
 * grow accordingly.
 *
 * ## The same pass groups dots that have collided
 *
 * It already holds every site's container point, which is the only input the
 * grouping needs, so working it out anywhere else would mean projecting all nine
 * coordinates twice per frame to reach the same answer. What comes out is a list
 * of clusters, and PinCluster draws a ring around each one - see cluster.ts for
 * why the map has to say this out loud and why nothing may be moved to do it.
 *
 * Membership goes through React state, so a count badge is a real element with
 * real text rather than something this pass writes by hand. Its *position* does
 * not: a centroid moves on every frame of a pan, and putting that in state would
 * re-render the layer sixty times a second. The badges are positioned here, the
 * way the cards and leaders are, and only their membership - which changes on a
 * zoom step, not on a drag - is allowed to reach React.
 *
 * ## Reporting sites are placed first
 *
 * All nine cards are drawn and all nine block each other, so somebody has to go
 * first, and whoever goes first gets the shortest leader. That should be the
 * three bases carrying live numbers rather than whichever of the six dark ones
 * happens to sit furthest west - the pass is a queue, and the queue is ordered
 * by whether anyone is reading the card.
 *
 * A site's reporting state changes rarely, so this is a stable order; when it
 * does change the map genuinely has different content on it and the labels are
 * expected to move.
 *
 * ## Tapping a card selects a base, and that is all this layer knows
 *
 * The detail panel is BaseDrawer, at the edge of the board and outside the map
 * entirely. An earlier version anchored it to the pin and placed it here, which
 * meant this pass also owned which base was open, how big the dialog was, and
 * which of the map's own controls it was allowed to cover. None of that was the
 * placement pass's business. What is left is a card that writes a code into the
 * selection store.
 */

/**
 * Seed offsets in pixels from each site's coordinate.
 *
 * Hand-tuned, and worth keeping hand-tuned: they encode which way each site
 * should lean given its neighbours - THS west and ASI east because they sit on
 * top of each other, IIS west and SUS north because they do too. No generic
 * algorithm knows that, and starting every card at the same place makes the
 * separation loop in step 5 decide it arbitrarily instead.
 *
 * Shorter than they were, by about a fifth. The offset is what the eye has to
 * follow back to the country, so the pass wants the smallest displacement that
 * still separates; the old figures were tuned against a view where half the
 * bases were off-screen and every card started by fighting the viewport edge.
 * Now that the fit puts all nine inside the box, they do not need the throw.
 *
 * The two extremes lean *inward* on purpose. STJ is the easternmost site and SMX
 * the westernmost, so a card thrown outward is a card thrown at the viewport
 * edge, where step 2 flips it back anyway; seeding the flip is one less thing
 * for the leader to do. STJ's card lands over the Yellow Sea, SMX's over the
 * Pacific - both empty, which is the other half of the choice.
 */
const SEED_OFFSETS: Record<string, [number, number]> = {
  THS: [-52, -8],
  ASI: [52, 22],
  VNS: [4, -46],
  STJ: [-54, -28],
  ISE: [6, 44],
  SUS: [-2, -46],
  IIS: [-54, 6],
  SMX: [-4, 44],
  SEH: [-10, -46],
};

/**
 * Fallback for a base not in the table - a tenth site, or a renamed code.
 *
 * Deliberately not a constant `[0, -40]`: two unknown codes would then start on
 * exactly the same pixel and the separation loop would resolve them in whatever
 * order the array happened to be in, which changes when the ranking re-sorts.
 * Hashing the code to an angle is stable across renders and spreads unknowns
 * around the circle.
 */
function seedFor(code: string): [number, number] {
  const known = SEED_OFFSETS[code];
  if (known) return known;
  let h = 0;
  for (let i = 0; i < code.length; i++) h = (h * 31 + code.charCodeAt(i)) | 0;
  const angle = ((h % 360) * Math.PI) / 180;
  return [Math.round(Math.cos(angle) * 50), Math.round(Math.sin(angle) * 40)];
}

/**
 * The pieces of chrome a label must not land on.
 *
 * `.map-controls` is the +/− pair top left and `.map-controls--right` the
 * expand toggle top right - two selectors for what used to be one stack,
 * because the boxes are measured with `querySelector` and a shared class would
 * only ever find the first of them. `.map-legend` is the tier key, and the
 * attribution is the one we are not legally allowed to cover at all. The legend
 * is a sibling of the Leaflet container rather than a child, hence measuring
 * from the panel rather than from the map.
 */
const CHROME = [
  '.map-controls',
  '.map-controls--right',
  '.map-legend',
  '.leaflet-control-attribution',
];

/** Breathing room between a label and a piece of chrome, in px. */
const CLEARANCE = 6;

/**
 * Keep-out boxes in container pixels, measured rather than declared.
 *
 * This used to be four hardcoded rectangles, and every one of them was a guess
 * that had already been wrong once. Two ways they go wrong: a control changes
 * size - the legend wraps to two lines in Thai, the kiosk density scales every
 * button - and the box no longer covers it. Or a control is removed and the box
 * stays, which is a hole the labels are pushed out of on behalf of nothing.
 * Both happened in this file. Reading the boxes off the DOM cannot drift,
 * because there is nothing left to keep in sync.
 */
function chromeZones(map: LeafletMap) {
  const container = map.getContainer();
  const panel = container.parentElement ?? container;
  const origin = container.getBoundingClientRect();

  return CHROME.flatMap((selector) => {
    const el = panel.querySelector(selector);
    if (!el) return [];
    const r = el.getBoundingClientRect();
    // A control that is display:none, or a legend still waiting on its first
    // paint, measures 0x0 - a zero-area keep-out at the origin, which is a
    // corner of the map, so it has to be dropped rather than dodged.
    if (r.width === 0 || r.height === 0) return [];
    return [
      {
        x0: r.left - origin.left - CLEARANCE,
        y0: r.top - origin.top - CLEARANCE,
        x1: r.right - origin.left + CLEARANCE,
        y1: r.bottom - origin.top + CLEARANCE,
      },
    ];
  });
}

/**
 * How far the count badge is held off the outermost dot in its cluster.
 *
 * Measured against the dot *plus its halo*, not the dot alone: the halo is a 2px
 * box-shadow painted with the dot at the top of the ladder, so anything tighter
 * than this ends up tucked under it.
 */
const BADGE_GAP = 7;
const EDGE = 6; // px of breathing room against the viewport edge
const GAP = 5; // px between two cards
/** How far outside the viewport a site may sit before its label is dropped. */
const OFFSCREEN = 64;
type Zone = { x0: number; y0: number; x1: number; y1: number };

/**
 * Move a box clear of the map's chrome, if there is anywhere for it to go.
 *
 * The direction is chosen per zone rather than fixed. An earlier version always
 * pushed left, which is right for a zone on the right edge and exactly wrong for
 * one on the left - it drove the card further under the zoom control instead of
 * out from under it. Here the four candidate escapes are scored by how far they
 * move the box and the shortest one that actually lands inside the viewport wins.
 *
 * A named function rather than the closure it started as, because the separation
 * loop below calls it on every pass and a reader tracing why a card moved should
 * find the rule in one place rather than inlined in the middle of that loop.
 */
function dodgeBox(
  box: { cx: number; cy: number; w: number; h: number },
  zones: Zone[],
  size: { x: number; y: number },
): { cx: number; cy: number } {
  const { w, h } = box;
  let { cx, cy } = box;

  for (const z of zones) {
    const hits = cx + w / 2 > z.x0 && cx - w / 2 < z.x1 && cy + h / 2 > z.y0 && cy - h / 2 < z.y1;
    if (!hits) continue;

    const candidates = [
      { x: z.x0 - w / 2 - EDGE, y: cy },
      { x: z.x1 + w / 2 + EDGE, y: cy },
      { x: cx, y: z.y0 - h / 2 - EDGE },
      { x: cx, y: z.y1 + h / 2 + EDGE },
    ]
      .filter(
        (p) =>
          p.x >= w / 2 + EDGE &&
          p.x <= size.x - w / 2 - EDGE &&
          p.y >= h / 2 + EDGE &&
          p.y <= size.y - h / 2 - EDGE,
      )
      .sort((a, b) => Math.hypot(a.x - cx, a.y - cy) - Math.hypot(b.x - cx, b.y - cy));

    // No escape fits - a zone larger than the map, or a box too big for the room
    // between two of them, which only happens on a panel too small to be useful.
    // Leave it where it is rather than shoving it off the edge.
    if (candidates.length === 0) continue;
    cx = candidates[0].x;
    cy = candidates[0].y;
  }

  return { cx, cy };
}

export function MapLabelLayer({
  companies,
  nowMs,
}: {
  companies: CompanySummary[];
  nowMs: number;
}) {
  const map = useMap();
  const cards = useRef(new Map<string, HTMLElement>());
  const badges = useRef(new Map<string, HTMLElement>());

  const registerCard = useCallback((code: string, el: HTMLElement | null) => {
    if (el) cards.current.set(code, el);
    else cards.current.delete(code);
  }, []);

  const registerBadge = useCallback((key: string, el: HTMLElement | null) => {
    if (el) badges.current.set(key, el);
    else badges.current.delete(key);
  }, []);

  /*
   * Which dots are currently piled on top of each other.
   *
   * State, because the badges are React elements; a ref guarding the signature,
   * because the pass that computes it runs on every frame of a drag and must be
   * able to decide "nothing changed" without touching React at all.
   */
  const [clusters, setClusters] = useState<Cluster[]>([]);
  const clusterSig = useRef('');

  /*
   * Reporting sites first, then by longitude within each group.
   *
   * Longitude so the separation loop resolves collisions left to right; placing
   * in array order instead makes a card's final position depend on the ranking
   * sort, which changes whenever %OA does - labels would hop around the map on
   * a poll that moved nothing geographically. Reporting first because the
   * visible cards should choose their positions before the hidden ones get a
   * say; a site's reporting state changes rarely, and when it does the map
   * genuinely has different content on it.
   */
  /*
   * Memoised on the payload. It used to be rebuilt inline on every render, which
   * gave `layout` a new identity every time and made the effect below tear down
   * and re-bind six map listeners for nothing. That was survivable while nothing
   * else set state in here; now that the grouping does, an unmemoised array is a
   * render loop.
   */
  const ordered = useMemo(
    () =>
      [...companies].sort(
        (a, b) => Number(isReporting(b.status)) - Number(isReporting(a.status)) || a.lng - b.lng,
      ),
    [companies],
  );

  const layout = useCallback(() => {
    const size = map.getSize();

    /*
     * The map lives in a tabpanel, and an unselected one is `display: none` -
     * so every measurement in here reads zero while another tab is showing.
     * Laying out against a 0x0 viewport collapses all nine cards onto a single
     * pixel, and nothing would move them back until the next map event.
     *
     * Skipping costs nothing: the ResizeObserver below fires again the moment
     * the tab is shown and the box has a real size.
     */
    if (size.x === 0 || size.y === 0) return;

    const placed: { cx: number; cy: number; w: number; h: number }[] = [];

    /*
     * Every site's coordinate in container pixels, projected once.
     *
     * The placement loop below used to call `latLngToContainerPoint` itself, per
     * site, per frame. It is needed twice now - once to place a pin and once to
     * find out which pins have collided - and projecting the same nine
     * coordinates twice in a frame to get the same nine answers is work the pass
     * can simply not do.
     */
    const points = ordered.map((c) => {
      const at = map.latLngToContainerPoint([c.lat, c.lng]);
      return { code: c.code, x: at.x, y: at.y };
    });
    const pointOf = new Map(points.map((p) => [p.code, p]));

    /*
     * Two dots overlap when their centres are closer than one diameter, so the
     * dot's own rendered width is the threshold - measured off the DOM in the
     * same spirit as the chrome keep-outs, and for the same reason: a declared
     * 8 goes stale the moment the kiosk density switch scales the layer, and
     * nothing would report the drift.
     *
     * A dark site's dot is a hair smaller than a reporting one, which is why the
     * measurement prefers a full-size one; the difference is under a pixel and
     * either answer groups the same pairs.
     */
    const container = map.getContainer();
    const sample =
      container.querySelector<HTMLElement>('.pin__dot:not(.pin__dot--quiet)') ??
      container.querySelector<HTMLElement>('.pin__dot');
    const diameter = sample?.offsetWidth || 8;

    const groups = groupOverlapping(points, diameter);
    const signature = groups.map((g) => g.key).join('|');
    if (signature !== clusterSig.current) {
      clusterSig.current = signature;
      setClusters(groups);
    }

    /*
     * Position the badges that already exist. A group that has just appeared has
     * no element yet - it is mounting from the setState above - and the effect
     * that watches `clusters` lays it out on the next frame.
     *
     * The element is sized to the group's footprint and the badge hangs off its
     * corner, so the count clears the dots without the CSS having to know how
     * far apart they are.
     */
    for (const group of groups) {
      const el = badges.current.get(group.key);
      if (!el) continue;
      const members = group.codes.map((code) => pointOf.get(code)).filter((p) => p !== undefined);
      if (members.length === 0) continue;
      const spot = clusterFootprint(members, diameter, BADGE_GAP);
      el.style.left = `${spot.cx}px`;
      el.style.top = `${spot.cy}px`;
      el.style.width = `${spot.r * 2}px`;
      el.style.height = `${spot.r * 2}px`;
      // Hidden with its members when the group is dragged off the panel, on the
      // same margin the pins use - a count beside nothing is worse than none.
      const on =
        spot.cx >= -OFFSCREEN &&
        spot.cx <= size.x + OFFSCREEN &&
        spot.cy >= -OFFSCREEN &&
        spot.cy <= size.y + OFFSCREEN;
      el.style.visibility = on ? '' : 'hidden';
    }

    /*
     * A count badge is a keep-out, like the zoom buttons and the legend.
     *
     * A dot is 8px and draws over a card without costing it a word, so it needs
     * no zone of its own. The badge is twice that and carries type, and a card
     * slid under it loses both ways round. The pass already knows how to route a
     * card around a box, so the badge becomes one.
     *
     * The box is the badge's own rectangle, read off the DOM right after the loop
     * above placed it, rather than the whole footprint it hangs from - that
     * footprint is mostly empty air with two dots in the middle, and reserving
     * all of it pushed the IIS card across the Atlantic to clear a corner
     * nothing was standing in.
     */
    const origin = container.getBoundingClientRect();
    const zones = [
      ...chromeZones(map),
      ...groups.flatMap((group) => {
        const el = badges.current.get(group.key)?.querySelector('.pin-cluster__count');
        if (!el) return [];
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return [];
        return [
          {
            x0: r.left - origin.left - CLEARANCE,
            y0: r.top - origin.top - CLEARANCE,
            x1: r.right - origin.left + CLEARANCE,
            y1: r.bottom - origin.top + CLEARANCE,
          },
        ];
      }),
    ];

    for (const company of ordered) {
      const pin = cards.current.get(company.code)?.parentElement;
      const card = cards.current.get(company.code);
      if (!pin || !card) continue;

      // The pin's origin is the site's coordinate; Leaflet gave us that in
      // container pixels above, and the layer shares the container's coordinate
      // space.
      const at = pointOf.get(company.code);
      if (!at) continue;
      pin.style.left = `${at.x}px`;
      pin.style.top = `${at.y}px`;

      /*
       * A site the viewer has zoomed or panned off the map.
       *
       * Its card cannot follow it - the clamp holds every card inside the
       * viewport - so what is left is a card pinned to an edge, joined by a
       * leader to a coordinate that is not there. Zoomed one step into Asia
       * that measured 485px: a hairline across the whole panel, pointing at
       * nothing, from a card claiming to label it. It also cost the sites still
       * on screen their space, since the pass has no idea the card is a lie.
       *
       * This only started to matter when the zoom buttons went in. Before them
       * the view was whatever the fit chose and every site was inside it by
       * construction.
       *
       * `visibility` rather than `display: none` for the usual two reasons: the
       * card stays measurable for the frame it comes back on, and it drops out
       * of the tab order, which is right - a link to a base that is not on the
       * map is not a link anyone can aim at.
       *
       * The margin is what stops this being a cliff. Cutting at the exact edge
       * makes a label blink out while its card is still comfortably on screen
       * and its dot is one pixel over, so a slow pan flickers; a seed's worth
       * of slack means the card fades out at about the point its leader stops
       * being followable anyway.
       */
      const onScreen =
        at.x >= -OFFSCREEN &&
        at.x <= size.x + OFFSCREEN &&
        at.y >= -OFFSCREEN &&
        at.y <= size.y + OFFSCREEN;
      pin.style.visibility = onScreen ? '' : 'hidden';
      if (!onScreen) continue;

      const w = card.offsetWidth;
      const h = card.offsetHeight;
      const [seedX, seedY] = seedFor(company.code);
      let dx = seedX;
      let dy = seedY;

      // Flip the lean inward rather than letting the card hang off an edge.
      if (at.x + dx + w / 2 > size.x - EDGE) dx = -Math.abs(dx);
      if (at.x + dx - w / 2 < EDGE) dx = Math.abs(dx);
      if (at.y + dy - h / 2 < EDGE) dy = Math.abs(dy);
      if (at.y + dy + h / 2 > size.y - EDGE) dy = -Math.abs(dy);

      const clampX = (v: number) => Math.min(Math.max(v, w / 2 + EDGE), size.x - w / 2 - EDGE);
      const clampY = (v: number) => Math.min(Math.max(v, h / 2 + EDGE), size.y - h / 2 - EDGE);

      let cx = clampX(at.x + dx);
      let cy = clampY(at.y + dy);

      /* Push the card clear of the map's own chrome. See dodgeBox. */
      const dodgeZones = () => {
        ({ cx, cy } = dodgeBox({ cx, cy, w, h }, zones, size));
      };
      /*
       * Separate from every card already placed, re-checking the control zones
       * on each pass.
       *
       * Both constraints are enforced in the *same* loop, and the zone check
       * comes first, so the position that finally breaks out has satisfied both.
       * An earlier version ran the separation loop and then dodged the zones one
       * last time afterwards - which is how STJ ended up underneath VNS: the
       * final dodge moved a card that separation had already placed, and nothing
       * re-checked it.
       *
       * 48 passes rather than 24: the map is a different shape in this layout
       * than the one this pass was written for, and a sideways step restarts the
       * search in a fresh column, which costs passes. If it does run out, the
       * card stays where it is - a slight overlap is a far better failure than a
       * card thrown off the panel.
       */
      /*
       * Every position this card has already occupied, so the loop can tell a
       * search from a deadlock.
       *
       * Without it a card wedged between two neighbours ping-pongs: VNS seeds
       * between STJ's card and ASI's, gets pushed down clear of STJ into ASI,
       * up clear of ASI into STJ, and back - 48 identical passes ending
       * wherever the count ran out, which was on top of STJ. Rejecting a
       * revisit forces the next-best option, and VNS lands above STJ on the
       * third pass instead. The loop's other exits are unchanged; this only
       * closes the cycle.
       */
      const visited = new Set<string>();
      const visit = () => visited.add(`${Math.round(cx)},${Math.round(cy)}`);
      visit();

      for (let i = 0; i < 48; i++) {
        dodgeZones();
        // Clamped *before* the overlap test, not after the loop. Clamping
        // afterwards is its own bug: it can shove a card the separation pass had
        // just resolved straight back into its neighbour, with nothing left to
        // re-check it - which is how STJ ended up under ISE in Thai, where the
        // cards are wider and the right-hand cluster is tighter.
        cx = clampX(cx);
        cy = clampY(cy);
        const hit = placed.find(
          (q) => Math.abs(q.cx - cx) < (q.w + w) / 2 + 4 && Math.abs(q.cy - cy) < (q.h + h) / 2 + 4,
        );
        if (!hit) break;

        /*
         * Push vertically first - a world map has more spare pixels above and
         * below a site than beside it - and sideways only when the column is
         * genuinely full.
         *
         * Both directions are chosen by where there is *room*, not by which
         * side of the neighbour the card happens to be on. Pushing blindly
         * away deadlocks against an edge: STJ and ISE both land bottom-right at
         * world zoom, the downward push left the viewport, the clamp pulled it
         * back, the attribution keep-out shoved it up again, and it landed on
         * ISE - every pass, all 32 of them. In Thai, where the cards are wider,
         * that was every load.
         */
        const stepY = (hit.h + h) / 2 + GAP;
        const up = hit.cy - stepY;
        const down = hit.cy + stepY;
        const upFits = up >= h / 2 + EDGE;
        const downFits = down <= size.y - h / 2 - EDGE;

        // Nearest first, up before down on a tie, and never back to a row this
        // card has already been rejected from.
        const rows = [upFits ? up : null, downFits ? down : null]
          .filter((y): y is number => y !== null)
          .filter((y) => !visited.has(`${Math.round(cx)},${Math.round(clampY(y))}`))
          .sort((a, b) => Math.abs(a - cy) - Math.abs(b - cy));

        if (rows.length > 0) {
          cy = rows[0];
        } else {
          // The column is full. Step sideways toward whichever side has more
          // free space - away from the neighbour is the wrong rule when that
          // direction is the one pinned against the panel edge.
          const roomLeft = cx - (w / 2 + EDGE);
          const roomRight = size.x - w / 2 - EDGE - cx;
          cx = clampX(cx + (roomRight >= roomLeft ? 1 : -1) * ((hit.w + w) / 2 + GAP));
          // Back to the seed row, so the new column is searched from where the
          // card wanted to be rather than from the bottom of the old one. Without
          // this the card keeps its exhausted y, collides again immediately, and
          // drifts sideways across the map one column per pass.
          cy = clampY(at.y + dy);
        }
        visit();
      }
      /*
       * Belt and braces for the case where the loop ran out of passes: the last
       * move inside it is not followed by a clamp, so a card can still be left
       * hanging over the edge. Being inside the box wins over being clear of a
       * neighbour - an overlapped card is still readable, a clipped one is not.
       */
      cx = clampX(cx);
      cy = clampY(cy);

      placed.push({ cx, cy, w, h });

      const ox = cx - at.x;
      const oy = cy - at.y;
      card.style.left = `${ox}px`;
      card.style.top = `${oy}px`;

      const line = pin.querySelector<HTMLElement>('.pin__line');
      if (line) {
        line.style.width = `${Math.sqrt(ox * ox + oy * oy)}px`;
        line.style.transform = `rotate(${(Math.atan2(oy, ox) * 180) / Math.PI}deg)`;
      }
    }
  }, [map, ordered]);

  /*
   * A badge that has just mounted has never been positioned: the pass that
   * discovered the group ran before its element existed, so it is sitting at
   * 0,0 in the corner of the map. Lay out again on the frame after the set
   * changes, which is the same thing the initial mount does for the cards.
   *
   * Cheap, and rare: the set changes when a zoom step separates a pile or
   * merges one, not while the map is being dragged.
   */
  useEffect(() => {
    const raf = requestAnimationFrame(layout);
    return () => cancelAnimationFrame(raf);
  }, [clusters, layout]);

  /*
   * The pin layer swallows the clicks its own cards receive.
   *
   * A card is a button, and a tap on it should select a base and do nothing to
   * the map - without this, the same tap also reaches Leaflet underneath, and a
   * double-tap on a card zooms the view. One call on the layer covers all nine
   * pins, because the layer is `pointer-events: none`: it is in the propagation
   * path of its own cards and of nothing else, so gestures on the map background
   * are untouched.
   */
  const attachLayer = useCallback((el: HTMLDivElement | null) => {
    if (el) DomEvent.disableClickPropagation(el);
  }, []);

  useEffect(() => {
    // Re-run after the browser has laid the cards out, or every offsetWidth
    // reads zero and all nine collapse onto their coordinates.
    const raf = requestAnimationFrame(layout);

    map.on('move zoom resize viewreset zoomend moveend', layout);

    // The panel is a flex child, so its box changes without the window moving -
    // a banner appearing, the kiosk density switch, the map being expanded.
    const ro = new ResizeObserver(() => layout());
    ro.observe(map.getContainer());

    return () => {
      cancelAnimationFrame(raf);
      map.off('move zoom resize viewreset zoomend moveend', layout);
      ro.disconnect();
    };
  }, [map, layout]);

  return createPortal(
    <div className="pin-layer" ref={attachLayer}>
      {companies.map((c) => (
        <CompanyPin key={c.code} company={c} nowMs={nowMs} registerCard={registerCard} />
      ))}

      {/*
       * After the pins, so a count never renders before the dots it counts.
       * Paint order is settled by the z-index ladder rather than by this, but a
       * reader tracing the layer should meet the sites first and the annotation
       * about them second.
       */}
      {clusters.map((cluster) => (
        <PinCluster key={cluster.key} cluster={cluster} registerBadge={registerBadge} />
      ))}
    </div>,
    map.getContainer(),
  );
}
