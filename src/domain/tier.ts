import type { Tier, TierPolicy } from '../api/contract';

/**
 * Tier handling - and the deliberate absence of tier *computation*.
 *
 * D-16 exists because the same %OA is coloured by two different rules today:
 * the web mockup uses `TARGET-5 / TARGET-20` (90/75 at target 95) while the
 * Grafana panels hardcode 95/80. A plant can therefore be amber on the exec
 * screen and green on the operator screen, and nobody can say which is right.
 *
 * Two constants in two codebases is the bug. The fix is one served value that
 * both read, so `oa_tier` arrives already resolved and this module only reads
 * it. `deriveTier` exists solely so mock data and the legend can describe the
 * policy - it is never used to overrule what the backend said.
 */

export function readTier(tier: Tier | null | undefined): Tier {
  // An absent tier must not default to good. Unknown renders grey with no
  // implication of health.
  return tier ?? 'unknown';
}

/**
 * Applies a tier policy to a value. Used for the legend text and for mock data
 * only. If you find yourself reaching for this to colour a number that came
 * from the API, use that payload's `oa_tier` instead - otherwise D-16 quietly
 * reopens.
 */
export function deriveTier(value: number | null, policy: TierPolicy): Tier {
  if (value === null) return 'unknown';
  if (value >= policy.good_at) return 'good';
  if (value >= policy.warn_at) return 'warn';
  return 'critical';
}

/** Human-readable bounds for the map legend, e.g. `>= 90`, `75-89`, `< 75`. */
export function tierBounds(policy: TierPolicy): { tier: Tier; label: string }[] {
  return [
    { tier: 'good', label: `≥ ${policy.good_at}` },
    { tier: 'warn', label: `${policy.warn_at}–${policy.good_at - 1}` },
    { tier: 'critical', label: `< ${policy.warn_at}` },
    { tier: 'unknown', label: '-' },
  ];
}

/**
 * How a KPI card is coloured. A separate axis from `Tier`: a card can be tinted
 * by something that is not a %OA tier at all - RUNNING is green because it
 * counts running machines, not because anything tiered it.
 */
export type KpiTone = 'neutral' | 'good' | 'warn' | 'critical';

/**
 * The served tier, mapped onto that axis.
 *
 * It lives here rather than beside the cards for two reasons. It is a statement
 * about what a tier *means*, which is this module's subject; and a component
 * file that exports a constant costs the whole file its Fast Refresh, which
 * eslint's react-refresh rule fails the build over.
 */
export const TIER_TONE: Record<Tier, KpiTone> = {
  good: 'good',
  warn: 'warn',
  critical: 'critical',
  unknown: 'neutral',
};
