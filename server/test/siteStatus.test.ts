import { describe, expect, it } from 'vitest';
import type { Freshness } from '@dashboard/contract';
import { latestSeen, plantStatusFrom, rollUpCompanyStatus } from '../src/domain/siteStatus.ts';

const FRESHNESS: Freshness = {
  stale_after_sec: 120,
  no_data_after_sec: 900,
  trend_stale_after_sec: 600,
};

const NOW = new Date('2026-08-25T02:00:00.000Z');
const ago = (sec: number) => new Date(NOW.getTime() - sec * 1000).toISOString();

function status(readiness: 'live' | 'installing' | 'planned', lastSeen: string | null) {
  return plantStatusFrom({ readiness, lastSeen, nowMs: NOW.getTime(), freshness: FRESHNESS });
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

describe('rollUpCompanyStatus', () => {
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
