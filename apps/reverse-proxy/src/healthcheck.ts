import type { Context } from 'hono';
import type { StatusCode } from 'hono/utils/http-status';

export const HEALTHCHECK_PATH = '/healthcheck';
export const HEALTHCHECK_BODY = 'ok';
const STATUS_OK = 200;
export const HEALTH_STATUS_OK: StatusCode = STATUS_OK;

export const handleHealthcheck = (c: Context): Response => {
  // biome-ignore lint/suspicious/noConsole: healthcheck visibility required.
  console.log('[reverse-proxy]', 'healthcheck', {
    timestamp: new Date().toISOString(),
    path: HEALTHCHECK_PATH,
  });
  return c.text(HEALTHCHECK_BODY, HEALTH_STATUS_OK);
};
