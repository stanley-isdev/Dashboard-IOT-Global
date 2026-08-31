import type { Tier, TierPolicy } from '@dashboard/contract';

/**
 * Ported from src/domain/tier.ts. D-16 exists because the same %OA was
 * coloured by two different rules: the web mockup used `TARGET-5 / TARGET-20`
 * (90/75 at target 95) while the Grafana panels hardcode 95/80. One served
 * value, computed here from the server-owned policy, replaces both.
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
