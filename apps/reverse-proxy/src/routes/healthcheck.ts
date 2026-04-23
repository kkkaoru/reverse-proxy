// Healthcheck endpoint handler
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Interfaces
interface HealthcheckLogDetail {
  timestamp: string;
  path: string;
}

// Constants
export const HEALTHCHECK_PATH: string = '/healthcheck';
export const HEALTHCHECK_BODY: string = 'ok';
const STATUS_OK: ContentfulStatusCode = 200;
export const HEALTH_STATUS_OK: ContentfulStatusCode = STATUS_OK;
const LOG_PREFIX: string = '[reverse-proxy]';
const LOG_EVENT_HEALTHCHECK: string = 'healthcheck';

// Functions
const createHealthcheckLogDetail = (): HealthcheckLogDetail => ({
  timestamp: new Date().toISOString(),
  path: HEALTHCHECK_PATH,
});

interface HealthcheckEnv {
  readonly WORKER_ID?: string;
}

export const handleHealthcheck = (c: Context<{ Bindings: HealthcheckEnv }>): Response => {
  // biome-ignore lint/suspicious/noConsole: healthcheck visibility required.
  console.log(LOG_PREFIX, LOG_EVENT_HEALTHCHECK, createHealthcheckLogDetail());
  const workerId: string = c.env?.WORKER_ID ?? 'unknown';
  return c.text(HEALTHCHECK_BODY, HEALTH_STATUS_OK, {
    'X-Worker-Id': workerId,
  });
};
