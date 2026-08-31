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

const TIER_TOKENS: Record<Tier, StatusToken> = {
  good: token('good', 'check-circle', 'tier.good'),
  warn: token('warn', 'alert-triangle', 'tier.warn'),
  critical: token('crit', 'alert-octagon', 'tier.critical'),
  // Never green. An unknown tier that renders as "on target" is worse than one
  // that renders as nothing.
  unknown: token('nodata', 'circle-dashed', 'tier.unknown'),
};

export function tierToken(tier: Tier): StatusToken {
  return TIER_TOKENS[tier];
}

/* ------------------------------------------------------------ site status */

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

const MEASURE_TOKENS: Record<MeasureKind, StatusToken> = {
  value: token('good', null, ''),
  stale: token('warn', 'clock', 'site.stale'),
  no_data: token('nodata', 'circle-dashed', 'site.no_data'),
  not_connected: token('nodata', 'circle-slash', 'site.not_connected'),
  not_applicable: token('nodata', 'minus', 'measure.not_applicable'),
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

export function severityToken(severity: 'critical' | 'major' | 'minor' | 'info'): StatusToken {
  switch (severity) {
    case 'critical':
      return token('crit', 'alert-octagon', 'severity.critical');
    case 'major':
      return token('warn', 'alert-triangle', 'severity.major');
    case 'minor':
      return token('warn', 'alert-circle', 'severity.minor');
    case 'info':
      return token('nodata', 'info-circle', 'severity.info');
  }
}
