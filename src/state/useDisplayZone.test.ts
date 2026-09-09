import { describe, expect, it } from 'vitest';
import { resolveDisplayZone } from './useDisplayZone';

const HQ = 'Asia/Bangkok';

describe('display zone', () => {
  it('prints a site timestamp on that site’s clock in site-local mode', () => {
    expect(resolveDisplayZone('site_local', HQ, 'Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveDisplayZone('site_local', HQ, 'America/Detroit')).toBe('America/Detroit');
  });

  it('collapses every site onto the reference zone in HQ mode', () => {
    for (const site of ['Asia/Tokyo', 'Europe/Budapest', 'America/Mexico_City']) {
      expect(resolveDisplayZone('reference', HQ, site)).toBe(HQ);
    }
  });

  /*
   * The decision the whole feature turns on. A fleet total, a snapshot
   * generation time or a PDF header belongs to no base, so site-local mode has
   * no clock to switch it to and it stays on the reference zone. Callers say so
   * by passing nothing.
   */
  it('keeps a fleet-wide timestamp on the reference zone in BOTH modes', () => {
    expect(resolveDisplayZone('site_local', HQ)).toBe(HQ);
    expect(resolveDisplayZone('reference', HQ)).toBe(HQ);
  });

  it('treats a missing or blank site zone as fleet-wide rather than handing Intl an empty string', () => {
    expect(resolveDisplayZone('site_local', HQ, null)).toBe(HQ);
    expect(resolveDisplayZone('site_local', HQ, '')).toBe(HQ);
  });

  it('follows the configured reference zone rather than a hardcoded one', () => {
    expect(resolveDisplayZone('reference', 'Asia/Tokyo', 'Europe/Budapest')).toBe('Asia/Tokyo');
  });
});
