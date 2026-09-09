import type { CompanyDetail, GlobalOverview, Meta, PlantDetail, Process, Range } from './contract';

/**
 * The seam between the application and its data source.
 *
 * Nothing above this interface knows whether a payload came from a JSON
 * generator in the browser or from HTTPS; nothing below it knows about React.
 * That is what lets phases 0-7 of the build proceed while D-01 (the backend
 * stack) is still open.
 */

export interface OverviewQuery {
  range: Range;
  /**
   * The calendar's two ends, as plain `YYYY-MM-DD` days in the reference zone,
   * or null for "use `range`".
   *
   * Both or neither. One end of a range is not a range, and the adapter drops a
   * half-set pair rather than inventing the other end from `range` - which
   * would answer a question the reader did not ask.
   *
   * `range` stays required beside them because it is what the capsule prints
   * and what the board falls back to when the server cannot honour the pair.
   * The response says which of the two was actually used, on `window.source`.
   */
  from: string | null;
  to: string | null;
  process: Process | 'all';
  /**
   * `all`, or a comma-separated list of ISO country codes and company codes.
   * The contract's region.ts owns the encoding and the matcher.
   */
  region: string;
  /**
   * The Lamp picker: `all`, or a comma-separated list of plant codes. Same
   * encoding as `region`, one level down, and the two intersect.
   *
   * It is what lets this board be compared with the per-plant operator boards,
   * which are scoped by `Lamp_var`.
   */
  plant: string;
  /**
   * The longest-active-stops panel's Top-N picker: how many rows `alerts`
   * comes back with. One of `ALERT_LIMIT_CHOICES` in state/useFilters.ts.
   */
  alertsLimit: number;
}

export interface ScopeQuery {
  range: Range;
  process: Process | 'all';
}

export interface PlantQuery extends ScopeQuery {
  /** `current` or an explicit shift code. */
  shift: string;
}

export interface DashboardApi {
  getMeta(signal?: AbortSignal): Promise<Meta>;
  getGlobalOverview(q: OverviewQuery, signal?: AbortSignal): Promise<GlobalOverview>;
  getCompany(company: string, q: ScopeQuery, signal?: AbortSignal): Promise<CompanyDetail>;
  getPlant(
    company: string,
    plant: string,
    q: PlantQuery,
    signal?: AbortSignal,
  ): Promise<PlantDetail>;
}
