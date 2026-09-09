import { describe, expect, it } from 'vitest';
import type { Absence } from '../api/contract';
import type { TFunction } from '../i18n/I18nProvider';
import { th } from '../i18n/th';
import { absenceTooltip, quietCaption } from './absence';

/**
 * The regression these exist for: the map pin used to caption a site with no
 * figure using `readiness.{data_readiness}`, so STJ - `live` in master data,
 * and staying `live` - drew a blank card labelled **"ใช้งานแล้ว" / "Live"**.
 * Config decided what the reader saw and got it wrong, the same failure as the
 * `no_data` status this whole change set out to fix.
 *
 * The rule since 2026-09-08 is that the reading comes from the database: a site
 * with an absence has no telemetry, and that is all the tile claims.
 */

/** Real Thai strings, so a missing or renamed key fails here rather than on screen. */
const t: TFunction = (key, params) => {
  const raw = th[key] ?? `MISSING:${key}`;
  return params
    ? Object.entries(params).reduce((s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw)
    : raw;
};

/** STJ: nothing has ever arrived, and config adds nothing - the normal case. */
const stj: Absence = { reason: null, owner: null, contradicts_config: true };

/** SEH: a human knows something the query cannot. */
const seh: Absence = {
  reason: 'กำลังติดตั้ง gateway 16 เครื่อง',
  owner: 'ทีม IoT',
  contradicts_config: false,
};
describe('quietCaption', () => {
  it('says never-received for a site nothing has ever come from', () => {
    expect(quietCaption('not_connected', t)).toBe('ยังไม่เคยได้รับข้อมูล');
  });

  it('distinguishes a shutdown week from a site that was never wired', () => {
    /*
     * The second half of the bug, and the one keying on `absence` alone missed.
     * `no_data` means connected but silent in this window - a holiday, a
     * retooling - and it is NOT isReporting, so the tile takes this branch while
     * `absence` is null for it. Before this case existed the line came out empty
     * and fell back to `readiness.{...}`, captioning a quiet company "Live".
     */
    expect(quietCaption('no_data', t)).toBe('ไม่มีข้อมูลในช่วงนี้');
    expect(quietCaption('no_data', t)).not.toBe(quietCaption('not_connected', t));
  });

  it('never renders a readiness word for any non-reporting state', () => {
    // The actual defect: `readiness` must not reach this card by any path.
    for (const s of ['not_connected', 'no_data'] as const) {
      const line = quietCaption(s, t)!;
      expect(line).not.toContain(th['readiness.live']);
      expect(line).not.toContain(th['readiness.installing']);
      expect(line).not.toContain(th['readiness.planned']);
      expect(line).not.toContain('MISSING');
    }
  });

  it('covers every non-reporting state, so the caller needs no fallback', () => {
    // `isReporting` is online|stale|degraded, so these two are the whole of the
    // else branch. A null here would put the old readiness fallback back in play.
    for (const s of ['not_connected', 'no_data'] as const) {
      expect(quietCaption(s, t), `${s} must have its own sentence`).not.toBeNull();
    }
  });

  it('returns null for a reporting site, whose numbers are shown instead', () => {
    for (const s of ['online', 'stale', 'degraded'] as const) {
      expect(quietCaption(s, t)).toBeNull();
    }
  });

  it('carries no day count, because no date survives scrutiny', () => {
    expect(quietCaption('not_connected', t)).not.toMatch(/\d/);
  });
});

describe('absenceTooltip', () => {
  const opts = { code: 'STJ', statusLabel: 'ยังไม่เชื่อมต่อ' };

  it('opens with identity and status, so the first line survives truncation', () => {
    expect(absenceTooltip(stj, opts, t)!.split('\n')[0]).toBe('STJ · ยังไม่เชื่อมต่อ');
  });

  it('names the config contradiction, which is the case somebody must chase', () => {
    expect(absenceTooltip(stj, opts, t)).toContain(th['absence.contradiction']);
  });

  it('holds together with nothing but the observation', () => {
    // STJ's whole tooltip: no reason, no owner, no invented date.
    const lines = absenceTooltip(stj, opts, t)!.split('\n');
    expect(lines).toHaveLength(3);
    expect(lines.some((l) => l.includes('MISSING'))).toBe(false);
    expect(lines.some((l) => l.includes('undefined') || l.includes('null'))).toBe(false);
  });

  it('adds the reason and owner where a human supplied them', () => {
    const lines = absenceTooltip(seh, { ...opts, code: 'SEH' }, t)!;
    expect(lines).toContain('กำลังติดตั้ง gateway 16 เครื่อง');
    expect(lines).toContain('ทีม IoT');
    // SEH is on schedule - not the case anyone needs to chase.
    expect(lines).not.toContain(th['absence.contradiction']);
  });

  it('returns null for a reporting site', () => {
    expect(absenceTooltip(null, opts, t)).toBeNull();
  });
});
