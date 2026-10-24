// Healthcheck endpoint handler
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

// Constants
export const HEALTHCHECK_PATH: string = '/healthcheck';
export const HEALTHCHECK_BODY: string = 'ok';
const STATUS_OK: ContentfulStatusCode = 200;
export const HEALTH_STATUS_OK: ContentfulStatusCode = STATUS_OK;

interface HealthcheckEnv {
  readonly WORKER_ID?: string;
}

// Load balancer probes hit this constantly: keep it free of logging, KV, D1 and
// browser work. Invocation logs already record each request.
export const handleHealthcheck = (c: Context<{ Bindings: HealthcheckEnv }>): Response => {
  const workerId: string = c.env?.WORKER_ID ?? 'unknown';
  return c.text(HEALTHCHECK_BODY, HEALTH_STATUS_OK, {
    'X-Worker-Id': workerId,
  });
};
