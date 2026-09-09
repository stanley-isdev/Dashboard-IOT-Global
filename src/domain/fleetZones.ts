import type { Meta } from '../api/contract';

/** One entry in the display-zone picker. */
export interface FleetZone {
  /** IANA name, e.g. `Asia/Tokyo`. */
  zone: string;
  /** Country names sharing this zone, joined - what the reader recognises. */
  label: string;
}

/**
 * The zones the fleet actually spans, for the display-zone dropdown.
 *
 * Derived from `/meta` rather than listed here, and that is the point: the day a
 * tenth base is commissioned in a country nobody anticipated, its clock appears
 * in the picker without a frontend change. A hardcoded list would be a second
 * copy of master data, drifting from the first the way the two %OA constants did
 * before D-16 closed.
 *
 * Deduplicated by zone, because two Thai bases are one clock - offering
 * "Asia/Bangkok" twice would make the list look like a bug. Where several
 * countries do share a zone the labels are joined, so the reader can still find
 * theirs by name.
 *
 * Sorted by name and not by offset, deliberately: a reader opens this looking
 * for a country, and "where does Hungary sit between +02 and +07" is a question
 * the list should not ask them.
 */
export function fleetZones(meta: Meta | null, lang: string): FleetZone[] {
  if (!meta) return [];

  const nameOf = new Map(
    meta.countries.map((c) => [c.code, (lang === 'th' && c.name_th ? c.name_th : c.name) || c.code]),
  );

  /* Zone -> the country names using it, in first-seen order and without
     repeats: two bases in one country must not double its name. */
  const byZone = new Map<string, string[]>();
  for (const co of meta.companies) {
    if (!co.timezone) continue;
    const names = byZone.get(co.timezone) ?? [];
    const name = nameOf.get(co.country_code) ?? co.country_code;
    if (!names.includes(name)) names.push(name);
    byZone.set(co.timezone, names);
  }

  return [...byZone.entries()]
    .map(([zone, names]) => ({ zone, label: names.join(' · ') }))
    .sort((a, b) => a.label.localeCompare(b.label, lang === 'th' ? 'th' : 'en'));
}
