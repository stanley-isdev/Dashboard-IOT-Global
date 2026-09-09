import type { MachineStatus, SiteStatus, StatusBucket, Tier } from '../api/contract';
import type { MeasureKind } from './measure';

/**
 * The status token registry - the only way to put a status on screen.
 *
 * Colour cannot carry the meaning here, and no choice of shades fixes that.
 * Measured on the approved palette, red and amber sit at a deuteranope colour
 * distance of 1.7-5.6 and red and green at 4.1; the usable floor is around 6-8.
 * A traffic-light encoding is unreadable for roughly one man in twelve, and
 * this dashboard's audience is largely men over forty.
 *
 * So the API below deliberately does not export a colour. It exports an icon
 * name, a translation key and a pair of CSS variable names. There is no way to
 * write a component that shows status by hue alone, because there is no function
 * that hands you a hue.
 *
 * The icons discriminate by outline rather than fine detail - at three metres a
 * serif is invisible, but triangle-versus-octagon-versus-ring is not. They used
 * to be single characters (▲ ● ■ ⊘); see StatusIcon for what a font was costing
 * us and why the shapes themselves did not change.
 */

/**
 * The marks StatusIcon knows how to draw.
 *
 * Named here rather than in the component so the dependency points the right
 * way: a component may read the domain, the domain may not read a component.
 * Each name is a *silhouette*, not a picture - see the note in StatusIcon for
 * why the set is built out of distinguishable outlines.
 */
export type StatusIconName =
  | 'check-circle'
  | 'alert-triangle'
  | 'alert-octagon'
  | 'clock'
  | 'circle-dashed'
  | 'circle-slash'
  | 'pause-circle'
  | 'circle-ellipsis'
  | 'info-circle'
  | 'alert-circle'
  | 'dot-circle'
  | 'minus';

export interface StatusToken {
  /**
   * Rendered before the label. Chosen to survive grayscale and distance.
   *
   * Null only for `value` - a figure that is simply present carries no mark, and
   * StatusGlyph renders nothing at all for it.
   */
  icon: StatusIconName | null;
  /** i18n key for the word that must accompany the icon. */
  labelKey: string;
  /** CSS custom property for fills, dots, pins, bars. Never for text. */
  markVar: string;
  /** CSS custom property for text. */
  inkVar: string;
  /** CSS custom property for badge backgrounds. */
  tintVar: string;
}

type ToneName = 'good' | 'warn' | 'crit' | 'nodata' | 'other';

function token(tone: ToneName, icon: StatusIconName | null, labelKey: string): StatusToken {
  return {
    icon,
    labelKey,
    markVar: `var(--status-${tone}-mark)`,
    inkVar: `var(--status-${tone}-ink)`,
    tintVar: `var(--status-${tone}-tint)`,
  };
}

/* ------------------------------------------------------------------ tier */

/**
 * A tier is a %OA reading, and since 2026-09-08 %OA has its own ink.
 *
 * The design owner asked for the figure on this board to be the same colour as
 * the figure on the operators' `Machine Status V2.0` panel, which paints its own
 * %OA in Tailwind's emerald/amber/red 600. That is a statement about %OA and
 * about nothing else, so it lands here - on the one token group that only ever
 * colours a tier - rather than on --status-*-ink, which RUNNING, STOP, the pills
 * and the banners all read and which none of them wanted moved.
 *
 * Marks and tints are untouched. The map pin, the tier dot and the badge grounds
 * stay on the palette that was measured for them; it is the *text* the panel and
 * this board disagreed about. See the waiver note over --oa-*-ink in tokens.css
 * for what the new inks cost as type, and check-contrast.mjs for the numbers.
 */
function oaToken(
  tone: 'good' | 'warn' | 'crit',
  icon: StatusIconName,
  labelKey: string,
): StatusToken {
  return { ...token(tone, icon, labelKey), inkVar: `var(--oa-${tone}-ink)` };
}

const TIER_TOKENS: Record<Tier, StatusToken> = {
  good: oaToken('good', 'check-circle', 'tier.good'),
  warn: oaToken('warn', 'alert-triangle', 'tier.warn'),
  critical: oaToken('crit', 'alert-octagon', 'tier.critical'),
  // Never green. An unknown tier that renders as "on target" is worse than one
  // that renders as nothing. No %OA ink either - there is no reading to colour,
  // so this one keeps the board's own grey.
  unknown: token('nodata', 'circle-dashed', 'tier.unknown'),
};

export function tierToken(tier: Tier): StatusToken {
  return TIER_TOKENS[tier];
}

/* ------------------------------------------------------------ site status */

/*
 * Two silences, one tone, and that last part is a decision worth recording
 * because it was made against the obvious alternative.
 *
 * `no_data` and `not_connected` are not the same state - domain/absence.ts
 * splits the words for exactly that reason, "nothing has ever arrived" against
 * "none in this window" - and on the map they were nonetheless the same grey
 * pin, so a base missing its gateway and a base on a shutdown week were
 * indistinguishable until you hovered one.
 *
 * A sixth tone was drawn for it (a measured blue, mark/ink/tint across all four
 * theme blocks) and then taken back out at the design owner's call on
 * 2026-09-09: **five status colours is already the ceiling this board can carry,
 * and a reader who has to learn a new hue to tell two kinds of silence apart is
 * being made to work for a distinction that costs nothing in shape.** The risk
 * was never contrast - the blue passed on every surface with headroom - it was
 * that green, amber, red, grey and violet already have to be held in the head
 * at once, and a sixth is where a legend stops being read at all.
 *
 * So both stay on `nodata` grey and the difference is carried entirely by
 * channels that need no key:
 *
 *   glyph   circle-slash for the absent link, circle-dashed for the empty
 *           window. Distinct silhouettes at three metres, and already here.
 *   words   quietCaption() prints which silence it is, on the card itself.
 *   weight  the map draws not_connected as a faded, dashed, unelevated card
 *           and no_data at full strength. Recession, not hue - see the
 *           .pin__card block in leaflet-overrides.css.
 *
 * The rule at the head of this file is what makes that sufficient rather than a
 * compromise: colour was never carrying status here in the first place.
 */
const SITE_TOKENS: Record<SiteStatus, StatusToken> = {
  online: token('good', 'check-circle', 'site.online'),
  stale: token('warn', 'clock', 'site.stale'),
  degraded: token('warn', 'pause-circle', 'site.degraded'),
  no_data: token('nodata', 'circle-dashed', 'site.no_data'),
  not_connected: token('nodata', 'circle-slash', 'site.not_connected'),
};

export function siteToken(status: SiteStatus): StatusToken {
  return SITE_TOKENS[status];
}

/** True when a site is contributing numbers, and so belongs in a denominator. */
export function isReporting(status: SiteStatus): boolean {
  return status === 'online' || status === 'stale' || status === 'degraded';
}

/**
 * True when a site should be ranked by performance.
 *
 * A stale site is still ranked - it did report, and its last figure is real.
 * It is excluded from "needs attention" separately, because escalating on a
 * number you know to be old wastes someone's morning.
 */
export function isRankable(status: SiteStatus): boolean {
  return isReporting(status);
}

/* --------------------------------------------------------- measure kinds */

/*
 * Every silence on the one grey, in step with SITE_TOKENS above - see the note
 * there for why the two kinds of no-data are told apart by glyph, word and
 * weight rather than by a colour of their own.
 */
const MEASURE_TOKENS: Record<MeasureKind, StatusToken> = {
  value: token('good', null, ''),
  stale: token('warn', 'clock', 'site.stale'),
  no_data: token('nodata', 'circle-dashed', 'site.no_data'),
  not_connected: token('nodata', 'circle-slash', 'site.not_connected'),
  not_applicable: token('nodata', 'circle-dashed', 'measure.not_applicable'),
};

export function measureToken(kind: MeasureKind): StatusToken {
  return MEASURE_TOKENS[kind];
}

/* ------------------------------------------------------- machine buckets */

const BUCKET_TOKENS: Record<StatusBucket, StatusToken> = {
  running: token('good', 'check-circle', 'bucket.running'),
  stopped: token('crit', 'alert-octagon', 'bucket.stopped'),
  idle: token('nodata', 'pause-circle', 'bucket.idle'),
  // D-21 is open, so 4M Change lands here with a neutral tone that is
  // deliberately neither green nor red. When the decision closes, the backend
  // moves it to another bucket and nothing in the UI changes.
  other: token('other', 'circle-ellipsis', 'bucket.other'),
  no_data: token('nodata', 'circle-dashed', 'bucket.no_data'),
};

export function bucketToken(bucket: StatusBucket): StatusToken {
  return BUCKET_TOKENS[bucket];
}

/**
 * Order in which machine buckets are shown. Fixed so the eye can compare two
 * plants without re-reading the labels.
 */
export const BUCKET_ORDER: StatusBucket[] = ['running', 'stopped', 'idle', 'other', 'no_data'];

/** i18n key for a raw machine status, e.g. `Mass Pro` -> `machine.mass_pro`. */
export function machineStatusKey(status: MachineStatus): string {
  return `machine.${status.toLowerCase().replace(/\s+/g, '_')}`;
}

/* ---------------------------------------------------------------- alerts */

/**
 * Alert severity. The only caller is the "longest active stops" list.
 *
 * `critical` draws a ring and not the octagon it used to. The octagon is the
 * right mark where it has to be told apart from `alert-triangle` across a
 * corridor - see the note on it in StatusIcon - but it was buying nothing here:
 * at the 12px this list runs at, an octagon beside a ring is a slightly lumpy
 * circle beside a round one, so the row paid for a distinct silhouette and did
 * not get one. It now draws the exclamation ring, which is the same mark read
 * at the same distance without pretending to a difference it cannot show.
 *
 * The four still differ in outline and not in hue, which is the rule the whole
 * registry exists to enforce: a ring, a triangle, a ring with a dot, a ring
 * with an "i". `minor` moved off the exclamation ring to make room, onto the
 * calmest interior in the set - which suits it better than an exclamation did.
 */
export function severityToken(severity: 'critical' | 'major' | 'minor' | 'info'): StatusToken {
  switch (severity) {
    case 'critical':
      return token('crit', 'alert-circle', 'severity.critical');
    case 'major':
      return token('warn', 'alert-triangle', 'severity.major');
    case 'minor':
      return token('warn', 'dot-circle', 'severity.minor');
    case 'info':
      return token('nodata', 'info-circle', 'severity.info');
  }
}
