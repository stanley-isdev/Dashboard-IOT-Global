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
  /**
   * For  only: how long the request was actually given, in ms.
   *
   * Carried on the error rather than read back off the config by whoever
   * renders it, because the two are no longer the same number - a window the
   * server has to assemble is allowed longer than the default board (see
   *  in httpAdapter.ts). A state page printing the config's
   * value would tell the reader the board waited ten seconds when it waited
   * forty-five.
   */
  readonly timeoutMs?: number;

  constructor(
    kind: ApiErrorKind,
    message: string,
    opts?: { status?: number; detail?: string; timeoutMs?: number },
  ) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind;
    this.status = opts?.status;
    this.detail = opts?.detail;
    this.timeoutMs = opts?.timeoutMs;
  }

  /** i18n key for the banner. Falls back to a generic message for unknown kinds. */
  get messageKey(): string {
    return `error.${this.kind}`;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}
