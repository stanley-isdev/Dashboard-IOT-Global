import { describe, expect, it } from 'vitest';
import { resolveDisplayZone, viewerTimeZone } from './useDisplayZone';

const HQ = 'Asia/Bangkok';

describe('display zone', () => {
  it('prints a site timestamp on that site’s clock in site-local mode', () => {
    expect(resolveDisplayZone('site_local', HQ, 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveDisplayZone('site_local', HQ, 'America/Detroit')).toBe('America/Detroit');
  });

  it('collapses every site onto one picked zone', () => {
    for (const site of ['Asia/Tokyo', 'Europe/Budapest', 'America/Mexico_City']) {
      expect(resolveDisplayZone('fixed', HQ, site, null, HQ)).toBe(HQ);
    }
  });

  /*
   * The decision the whole feature turns on. A fleet total, a snapshot
   * generation time or a PDF header belongs to no base, so site-local mode has
   * no clock to switch it to and it stays on the reference zone. Callers say so
   * by passing nothing.
   */
  it('keeps a fleet-wide timestamp on the reference zone in site-local and fixed alike', () => {
    expect(resolveDisplayZone('site_local', HQ)).toBe(HQ);
    expect(resolveDisplayZone('fixed', HQ, undefined, null, HQ)).toBe(HQ);
  });

  it('treats a missing or blank site zone as fleet-wide rather than handing Intl an empty string', () => {
    expect(resolveDisplayZone('site_local', HQ, null)).toBe(HQ);
    expect(resolveDisplayZone('site_local', HQ, '')).toBe(HQ);
  });

  it('falls back to the configured reference zone, never a hardcoded one', () => {
    expect(resolveDisplayZone('fixed', 'Asia/Tokyo', 'Europe/Budapest', null, 'Asia/Tokyo')).toBe('Asia/Tokyo');
  });
});

/*
 * Viewer mode, added 2026-09-09 for colleagues outside Thailand: a Thai plant's
 * stop should be readable in JST without adding seven hours in your head.
 *
 * It is the one mode where two people reading the same board see different
 * numbers, which is why the panel names the zone in force rather than just
 * saying "your clock" - see the note on `time.viewerNote`.
 */
describe('display zone - viewer mode', () => {
  const TOKYO = 'Asia/Tokyo';

  it('prints every site on the reader’s clock, whatever the site is', () => {
    for (const site of ['Asia/Bangkok', 'Europe/Budapest', 'America/Mexico_City']) {
      expect(resolveDisplayZone('viewer', HQ, site, TOKYO)).toBe(TOKYO);
    }
  });

  it('applies to fleet-wide timestamps too, unlike site-local', () => {
    /*
     * The deliberate difference. A snapshot generation time has no site clock,
     * so `site_local` leaves it on the reference zone - but it does have the
     * reader's, and "built at 15:04 your time" is meaningful where "15:04 at
     * some base" is not.
     */
    expect(resolveDisplayZone('viewer', HQ, undefined, TOKYO)).toBe(TOKYO);
    expect(resolveDisplayZone('site_local', HQ, undefined, TOKYO)).toBe(HQ);
  });

  it('falls back to the reference zone when the browser will not name one', () => {
    // `resolvedOptions()` returns undefined on older engines and Intl throws a
    // RangeError on a blank zone, so this must never reach a formatter.
    expect(resolveDisplayZone('viewer', HQ, 'Asia/Tokyo', null)).toBe(HQ);
    expect(resolveDisplayZone('viewer', HQ, 'Asia/Tokyo', '')).toBe(HQ);
    expect(resolveDisplayZone('viewer', HQ, 'Asia/Tokyo', undefined)).toBe(HQ);
  });

  it('leaves the other two modes untouched by the reader’s zone', () => {
    // The guarantee that adding this mode changed nothing for existing readers:
    // passing a viewer zone must not move site-local or HQ.
    expect(resolveDisplayZone('site_local', HQ, 'Asia/Tokyo', 'America/Detroit')).toBe('Asia/Tokyo');
    expect(resolveDisplayZone('fixed', HQ, 'Asia/Tokyo', 'America/Detroit', HQ)).toBe(HQ);
  });
});

describe('viewerTimeZone', () => {
  it('names a zone or null, never a blank string', () => {
    const z = viewerTimeZone();
    expect(z === null || (typeof z === 'string' && z.length > 0)).toBe(true);
  });
});
