import { describe, expect, it } from 'vitest';
import type { Meta } from '../api/contract';
import { fleetZones } from './fleetZones';

/**
 * The picker's list comes from `/meta` rather than a constant, so a tenth base
 * in a country nobody anticipated appears without a frontend change. A
 * hardcoded list would be a second copy of master data - the same shape as the
 * two-constants bug D-16 closed.
 */

const meta = (
  companies: { code: string; country_code: string; timezone: string }[],
  countries: { code: string; name: string; name_th: string | null }[],
) => ({ companies, countries }) as unknown as Meta;

describe('fleetZones', () => {
  it('offers one entry per distinct clock, not one per base', () => {
    // THS and ASI are both Asia/Bangkok. Listing it twice would read as a bug.
    const z = fleetZones(
      meta(
        [
          { code: 'THS', country_code: 'TH', timezone: 'Asia/Bangkok' },
          { code: 'ASI', country_code: 'TH', timezone: 'Asia/Bangkok' },
          { code: 'STJ', country_code: 'JP', timezone: 'Asia/Tokyo' },
        ],
        [
          { code: 'TH', name: 'Thailand', name_th: 'ไทย' },
          { code: 'JP', name: 'Japan', name_th: 'ญี่ปุ่น' },
        ],
      ),
      'en',
    );
    expect(z.map((x) => x.zone).sort()).toEqual(['Asia/Bangkok', 'Asia/Tokyo']);
  });

  it('names the country once even when two bases share it', () => {
    const z = fleetZones(
      meta(
        [
          { code: 'THS', country_code: 'TH', timezone: 'Asia/Bangkok' },
          { code: 'ASI', country_code: 'TH', timezone: 'Asia/Bangkok' },
        ],
        [{ code: 'TH', name: 'Thailand', name_th: 'ไทย' }],
      ),
      'en',
    );
    expect(z[0]!.label).toBe('Thailand');
  });

  it('joins the countries that share one clock, so a reader still finds theirs', () => {
    const z = fleetZones(
      meta(
        [
          { code: 'THS', country_code: 'TH', timezone: 'Asia/Bangkok' },
          { code: 'VNS', country_code: 'VN', timezone: 'Asia/Bangkok' },
        ],
        [
          { code: 'TH', name: 'Thailand', name_th: 'ไทย' },
          { code: 'VN', name: 'Vietnam', name_th: 'เวียดนาม' },
        ],
      ),
      'en',
    );
    expect(z).toHaveLength(1);
    expect(z[0]!.label).toContain('Thailand');
    expect(z[0]!.label).toContain('Vietnam');
  });

  it('follows the reader’s language', () => {
    const input = meta(
      [{ code: 'STJ', country_code: 'JP', timezone: 'Asia/Tokyo' }],
      [{ code: 'JP', name: 'Japan', name_th: 'ญี่ปุ่น' }],
    );
    expect(fleetZones(input, 'th')[0]!.label).toBe('ญี่ปุ่น');
    expect(fleetZones(input, 'en')[0]!.label).toBe('Japan');
  });

  it('falls back to the country code when no name is published', () => {
    // Better a code the reader can look up than an entry labelled "undefined".
    const z = fleetZones(
      meta([{ code: 'XX', country_code: 'MX', timezone: 'America/Mexico_City' }], []),
      'en',
    );
    expect(z[0]!.label).toBe('MX');
  });

  it('is empty before meta lands, rather than guessing a list', () => {
    expect(fleetZones(null, 'th')).toEqual([]);
  });
});
