/**
 * A typed failure from the data layer.
 *
 * `kind` exists so the UI can say something useful instead of showing one red
 * box for every problem. `contract` in particular earns its keep during
 * integration: "totals.oa_pct - expected number|null, received string" points
 * straight at the offending field, where a generic error costs an afternoon.
 */
export type ApiErrorKind =
  | 'network' // could not reach the server at all
  | 'timeout' // server did not answer in time
  | 'http' // server answered with a non-2xx
  | 'unauthorized' // 401 - reserved for when SSO lands (D-08)
  | 'contract' // answered, but the payload does not match the agreed shape
  | 'notfound'; // the company or plant in the URL does not exist

export class ApiError extends Error {
  readonly kind: ApiErrorKind;
  readonly status?: number;
  readonly detail?: string;

  constructor(kind: ApiErrorKind, message: string, opts?: { status?: number; detail?: string }) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts?.status;
    this.detail = opts?.detail;
  }

  /** i18n key for the banner. Falls back to a generic message for unknown kinds. */
  get messageKey(): string {
    return `error.${this.kind}`;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
