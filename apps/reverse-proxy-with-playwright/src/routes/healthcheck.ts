// Healthcheck route handler
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import { HTTP_STATUS_OK, LOG_PREFIX, SERVICE_NAME_MAIN } from '../constants.ts';
import type { WorkerBindings } from '../global.d.ts';
import type { HealthcheckResponse } from '../types.ts';
import { jsonResponse } from '../utils/response.ts';

export const handleHealthcheck = (c: Context<{ Bindings: WorkerBindings }>): Response => {
  const timestamp: string = new Date().toISOString();
  const body: HealthcheckResponse = {
    status: 'ok',
    timestamp,
    service: SERVICE_NAME_MAIN,
  };

  console.log(LOG_PREFIX, 'healthcheck', {
    timestamp,
    path: c.req.path,
  });

  return jsonResponse(c, body, HTTP_STATUS_OK);
};
