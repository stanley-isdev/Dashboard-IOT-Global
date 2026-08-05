/**
 * Mock scenarios, selected with `?scenario=` in the URL.
 *
 * These exist to make the failure modes demonstrable before there is a backend
 * to fail. Three of the five map directly onto acceptance criteria that are
 * otherwise very hard to exercise on demand.
 */
export const SCENARIOS = {
  /**
   * Reality as of the design doc's section 11: THS, ASI and STJ report; the
   * other six have no gateway. This is the default because a demo that shows
   * nine healthy sites would hide the single most important behaviour in the
   * product.
   */
  default: 'default',

  /**
   * THS was reporting and has gone quiet. Proves T-11: the site must read as
   * stale, its last known numbers must stay on screen, and nothing anywhere may
   * describe it as "stopped".
   */
  'site-offline': 'site-offline',

  /**
   * The API itself fails. Proves the section 14 failure NFR: a banner with the
   * last-good timestamp appears, the previous numbers remain visible, and no
   * zero is ever fabricated.
   */
  'backend-down': 'backend-down',

  /**
   * MSSQL is down but InfluxDB is fine. Proves the degraded state — the parts
   * of the payload that still work are shown, and the parts that do not are
   * named rather than silently omitted.
   */
  partial: 'partial',

  /** Everything above target. The screenshot for the steering deck. */
  'all-healthy': 'all-healthy',
} as const;

export type Scenario = keyof typeof SCENARIOS;

export const DEFAULT_SCENARIO: Scenario = 'default';

export function parseScenario(value: string | null | undefined): Scenario {
  return value && value in SCENARIOS ? (value as Scenario) : DEFAULT_SCENARIO;
}
