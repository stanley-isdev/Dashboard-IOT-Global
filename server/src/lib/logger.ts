import pino from 'pino';

/** For use outside request scope (boot, background health probes). Route handlers should prefer `request.log`/`app.log`. */
export const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });
