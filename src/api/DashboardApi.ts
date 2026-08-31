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
