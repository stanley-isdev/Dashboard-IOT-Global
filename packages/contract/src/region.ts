/**
 * The `region` query parameter, and the one place its encoding is defined.
 *
 * The value is either the literal `all` or a comma-separated list of scope
 * tokens, where a token is an ISO country code or a company code:
 *
 *   region=all            the group
 *   region=TH             both Thai bases
 *   region=TH,STJ         both Thai bases and Japan's
 *   region=THS,SEH        one base in Thailand and the Hungarian one
 *   region=none           no base at all
 *
 * `none` is the empty scope, and it exists because the picker's All row is a
 * switch rather than a one-way widening: a reader who wants three of the nine
 * clears the lot with one tap and ticks the three, instead of unticking six.
 * It is a real answer - "nothing selected" - and the board that comes back is
 * honestly empty rather than quietly showing the whole fleet again.
 *
 * A list rather than a repeated parameter (`region=TH&region=JP`) because
 * filters live in the URL on this board - the whole state of a view is meant to
 * be readable over the phone and pasteable into a kiosk's config - and one
 * `region=TH,STJ` survives that trip where two same-named parameters do not.
 *
 * A country token selects every base under it, which is what keeps the common
 * multi-select short: picking both Thai bases writes `TH`, not `THS,ASI`. The
 * two forms mean the same thing to a reader of the URL and to this matcher, so
 * a hand-written `region=THS,ASI` behaves identically.
 *
 * Unknown tokens are not an error and are not silently dropped: they simply
 * match nothing, so `?region=ZZ` yields an empty scope rather than quietly
 * widening back to the whole group - a filter that ignores what it was given is
 * how a screen ends up claiming to show one thing while summing another.
 */

/** The parameter that selects nothing. */
export const REGION_NONE = 'none';

/**
 * Every scope token in the parameter, or `null` for the whole group. An empty
 * array is the empty scope - `none` - and is deliberately not the same value as
 * `null`, which is what makes "nothing" survive the round trip through a URL.
 */
export function parseRegions(region: string | null | undefined): string[] | null {
  if (region === null || region === undefined) return null;
  const tokens = region
    .split(',')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
  // `all` anywhere in the list wins: it is the widest scope, so any list
  // containing it already means everything. An absent value is the same thing -
  // no filter was asked for.
  if (tokens.length === 0 || tokens.includes('all')) return null;
  // `none` only means the empty scope on its own. Beside a real token it is the
  // leftover of an edit somebody made by hand, and the real token is the intent.
  return [...new Set(tokens.filter((s) => s !== REGION_NONE))];
}

/** The parameter for a set of tokens. Empty is the empty scope, not the group. */
export function formatRegions(tokens: readonly string[]): string {
  return tokens.length === 0 ? REGION_NONE : tokens.join(',');
}

/**
 * Parsed once, applied many times: the filter runs over every company on every
 * request, and splitting the same string nine times per payload is work nobody
 * asked for.
 */
export function regionMatcher(
  region: string,
): (company: { code: string; country_code: string }) => boolean {
  const tokens = parseRegions(region);
  if (tokens === null) return () => true;
  const set = new Set(tokens);
  return (company) => set.has(company.code) || set.has(company.country_code);
}

/**
 * The `plant` parameter - the Lamp picker - in the same encoding as `region`,
 * one level further down: `all`, `none`, or a comma-separated list of plant
 * codes (`plant=6332`, `plant=6332,6338`).
 *
 * It exists because the operator boards on the wall are **per plant**
 * (`Lamp_var`), while this board is per company. Reading "THS 30" against
 * "Lamp 2: 29" and calling them a mismatch is the failure this closes: they are
 * different scopes, and until the reader could select a Lamp there was no way to
 * put the two side by side. Measured 2026-08-27: THS is 6332 (29 machines) plus
 * 6338 (1), so the company is 30 and neither figure is wrong.
 *
 * Deliberately NOT nested inside the region menu. A plant belongs to exactly one
 * company, so the two filters compose by intersection and a reader can hold
 * "which company" and "which Lamp" as separate thoughts - which is how they are
 * asked for out loud.
 *
 * Same encoding as `region` so a URL stays readable and one parser owns both.
 * Unknown codes match nothing rather than widening back to everything.
 */
export function plantMatcher(plant: string): (p: { code: string }) => boolean {
  const tokens = parseRegions(plant);
  if (tokens === null) return () => true;
  const set = new Set(tokens);
  return (p) => set.has(p.code);
}

/** True when the parameter narrows anything at all - `all` and absent do not. */
export function plantFilterActive(plant: string): boolean {
  return parseRegions(plant) !== null;
}
