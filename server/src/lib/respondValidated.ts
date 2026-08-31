import { z } from 'zod';
import { logger } from './logger.ts';

/**
 * Validates a response against its contract schema immediately before it goes
 * out, mirroring the frontend's `assertOrCollect` idiom (throw in dev, log
 * best-effort in prod) - a contract violation is caught at the source, in
 * server logs, instead of surfacing three hops later as the frontend's
 * `ApiError('contract', ...)`.
 */
export function respondValidated<T extends z.ZodType>(schema: T, payload: unknown): z.infer<T> {
  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    const message = z.prettifyError(parsed.error);
    if (process.env.NODE_ENV !== 'production') {
      throw new Error(`Response failed to validate against contract:\n${message}`);
    }
    logger.error({ err: message }, 'response failed to validate against contract');
  }
  return payload as z.infer<T>;
}
