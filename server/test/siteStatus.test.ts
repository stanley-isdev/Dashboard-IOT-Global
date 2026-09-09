import { describe, expect, it } from 'vitest';
import type { Freshness } from '@dashboard/contract';
import {
  absenceFor,
  latestSeen,
  plantStatusFrom,
  rollUpCompanyStatus,
  type EverSeen,
} from '../src/domain/siteStatus.ts';

const FRESHNESS: Freshness = {
  stale_after_sec: 120,
  no_data_after_sec: 900,
  trend_stale_after_sec: 600,
};

const NOW = new Date('2026-08-25T02:00:00.000Z');
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString();

/**
 * `everSeen` defaults to `'unknown'` - the state every plant is in before the
 * first Q-09 probe lands - so the cases below all assert the behaviour a reader
 * gets with no probe answer at all. The `'yes'`/`'no'` fork has its own describe
 * block further down.
 */
function status(
  readiness: 'live' | 'installing' | 'planned',
  lastSeen: string | null,
  everSeen: EverSeen = 'unknown',
) {
  return plantStatusFrom({
    readiness,
    lastSeen,
    everSeen,
    nowMs: NOW.getTime(),
    freshness: FRESHNESS,
  });
}

describe('plantStatusFrom - the four-way distinction T-11 exists for', () => {
  it('reads a site with no gateway as not_connected, never as stopped', () => {
    expect(status('installing', null)).toBe('not_connected');
    expect(status('planned', null)).toBe('not_connected');
    // Even if telemetry somehow arrived, readiness governs: the rollout state
    // is a fact about the site, not about the last packet.
    expect(status('installing', ago(1))).toBe('not_connected');
  });

  it('walks the freshness ladder from the server-owned policy', () => {
    expect(status('live', ago(5))).toBe('online');
    expect(status('live', ago(120))).toBe('online'); // boundary is inclusive
    expect(status('live', ago(121))).toBe('stale');
    expect(status('live', ago(900))).toBe('stale');
    expect(status('live', ago(901))).toBe('no_data');
  });

  it('reads a live site we have never heard from as no_data', () => {
    expect(status('live', null)).toBe('no_data');
  });

  it('does not crash on an unparseable timestamp', () => {
    expect(status('live', 'not-a-date')).toBe('no_data');
  });
});

describe('everSeen - the fork that separates "never wired" from "quiet"', () => {
  /*
   * The STJ case (BACKEND-HANDOVER §4.3b). Master data calls it `live`, no row
   * of its telemetry has ever arrived at this backend, and before `everSeen`
   * existed the board called that `no_data` - which reads as "the plant is
   * quiet" and sends an executive after a site that is doing nothing wrong.
   */
  it('reads a live-but-never-heard-from site as not_connected, not no_data', () => {
    expect(status('live', null, 'no')).toBe('not_connected');
  });

  it('keeps a site that HAS reported before on no_data when it goes quiet', () => {
    // The holiday / shutdown / no-open-order case. Silence here is a fact about
    // production, not about the pipe, and it must not read as "never wired".
    expect(status('live', null, 'yes')).toBe('no_data');
    expect(status('live', ago(4000), 'yes')).toBe('no_data');
  });

  it('lets direct evidence outrank a stale probe answer', () => {
    // A plant in the hot window has demonstrably reached us. Even if the probe
    // has not caught up and still says `no`, the rows in hand win.
    expect(status('live', ago(1), 'no')).toBe('online');
    expect(status('live', ago(300), 'no')).toBe('stale');
  });

  it('behaves exactly as before while the probe has not answered', () => {
    // The no-regression guarantee: `unknown` is every plant's state at boot and
    // for any poller built without plantCodes, and it must change nothing.
    expect(status('live', null, 'unknown')).toBe('no_data');
    expect(status('live', ago(1), 'unknown')).toBe('online');
  });

  it('still lets config veto: no gateway means not_connected whatever the data says', () => {
    expect(status('installing', null, 'yes')).toBe('not_connected');
    expect(status('planned', ago(1), 'yes')).toBe('not_connected');
  });

  it('never lets a malformed timestamp read as never-connected', () => {
    // A row we cannot date still proves the plant reached us.
    expect(status('live', 'not-a-date', 'no')).toBe('no_data');
  });
});

describe('rollUpCompanyStatus', () => {
  it('rolls a company up to not_connected when every plant is', () => {
    // Without this, STJ's single plant resolves correctly and then the company
    // roll-up undoes it: `not_connected` is not a reporting state, so all of
    // these would fall into the "nothing reports" case and read `no_data`.
    expect(rollUpCompanyStatus('live', ['not_connected'])).toBe('not_connected');
    expect(rollUpCompanyStatus('live', ['not_connected', 'not_connected'])).toBe('not_connected');
  });

  it('treats one never-connected plant beside a live one as degraded', () => {
    expect(rollUpCompanyStatus('live', ['online', 'not_connected'])).toBe('degraded');
  });

  it('reports degraded when some plants report and some do not', () => {
    expect(rollUpCompanyStatus('live', ['online', 'no_data'])).toBe('degraded');
    expect(rollUpCompanyStatus('live', ['stale', 'no_data', 'no_data'])).toBe('degraded');
  });

  it('is online only when every plant is online', () => {
    expect(rollUpCompanyStatus('live', ['online', 'online'])).toBe('online');
    expect(rollUpCompanyStatus('live', ['online', 'stale'])).toBe('stale');
  });

  it('is no_data when nothing reports, and not_connected when there is no gateway', () => {
    expect(rollUpCompanyStatus('live', ['no_data', 'no_data'])).toBe('no_data');
    expect(rollUpCompanyStatus('live', [])).toBe('no_data');
    expect(rollUpCompanyStatus('planned', ['no_data'])).toBe('not_connected');
  });
});

describe('latestSeen', () => {
  it('returns the most recent instant, ignoring nulls and junk', () => {
    expect(latestSeen([null, ago(300), ago(30), 'nonsense'])).toBe(ago(30));
    expect(latestSeen([null, null])).toBeNull();
    expect(latestSeen([])).toBeNull();
  });
});

describe('absenceFor - the reading comes from the database', () => {
  it('flags a config contradiction when a `live` site has never reported', () => {
    // The STJ shape. Master data says live, nothing has ever arrived, and both
    // cannot be true - that is a fault someone owns, not a rollout stage.
    const a = absenceFor({ status: 'not_connected', readiness: 'live', note: null })!;
    expect(a.contradicts_config).toBe(true);
  });

  it('returns an absence even with no note, so the tile never falls back to config', () => {
    /*
     * The regression this guards. When `absenceFor` returned `null` for an
     * unannotated site, CompanyPin fell through to `readiness.{data_readiness}`
     * and captioned STJ's empty tile "Live". The object's presence - not its
     * contents - is what tells the UI there is nothing to show.
     */
    const a = absenceFor({ status: 'not_connected', readiness: 'live', note: null });
    expect(a).not.toBeNull();
    expect(a!.reason).toBeNull();
    expect(a!.owner).toBeNull();
  });

  it('does not flag a site that is simply waiting its turn in the rollout', () => {
    const a = absenceFor({
      status: 'not_connected',
      readiness: 'installing',
      note: { reason: 'gateways going in', owner: 'IoT team' },
    })!;
    expect(a.contradicts_config).toBe(false);
    expect(a.reason).toBe('gateways going in');
    expect(a.owner).toBe('IoT team');
  });

  it('drops the explanation the moment the site reports', () => {
    // Config keeps its note; a reporting site simply has no absence to explain,
    // so a stale note can never sit under live numbers.
    const note = { reason: 'gateways going in', owner: 'IoT team' };
    for (const status of ['online', 'stale', 'no_data', 'degraded'] as const) {
      expect(absenceFor({ status, readiness: 'live', note })).toBeNull();
    }
  });
});
