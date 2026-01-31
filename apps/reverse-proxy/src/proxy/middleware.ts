// Proxy cache middleware
// Execute with bun: wrangler dev

import type { Context, MiddlewareHandler, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { logEvent } from './cache.ts';
import {
  ERROR_MISSING_URL,
  LOG_EVENT_MISSING_QUERY,
  METHOD_POST,
  QUERY_KEY_TARGET,
  ROOT_PATH,
  STATUS_BAD_REQUEST,
} from './constants.ts';
import { createHandlerMaps } from './handlers.ts';
import { createOptionsFromEnv } from './options.ts';
import { createErrorResponse } from './responses.ts';
import type {
  BatchRequestHandler,
  ProxyCacheEnv,
  ProxyCacheOptions,
  ProxyCacheStaticOptions,
  RequestHandler,
} from './types.ts';
import { buildTargetUrl, extractRawQuery } from './url.ts';

// Module-level counter for IP rotation round-robin
const ipRotateCounters: Map<string, number> = new Map();

// Handle POST batch request
const handlePostRequest = async (
  c: Context,
  batchHandler: BatchRequestHandler,
): Promise<Response> => {
  const body: unknown = await c.req.json().catch((): null => null);
  return batchHandler(body);
};

// Handle query-based request (GET/HEAD/DELETE)
const handleQueryRequest = (
  c: Context,
  options: ProxyCacheOptions,
  handler: RequestHandler,
): Promise<Response> => {
  const baseTarget: string | undefined = c.req.query(QUERY_KEY_TARGET);

  if (!baseTarget) {
    logEvent(options, LOG_EVENT_MISSING_QUERY, { method: c.req.method });
    return Promise.resolve(createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST));
  }

  const rawProxyQuery: string = extractRawQuery(c.req.url);
  const target: string = buildTargetUrl(baseTarget, rawProxyQuery);

  return handler(target);
};

// Create proxy cache middleware
export const createProxyCacheMiddleware = (
  staticOptions: ProxyCacheStaticOptions,
): MiddlewareHandler =>
  createMiddleware(async (c: Context<{ Bindings: ProxyCacheEnv }>, next: Next) => {
    if (c.req.path !== ROOT_PATH) {
      await next();
      return;
    }

    const options: ProxyCacheOptions = createOptionsFromEnv(staticOptions, c.env, ipRotateCounters);
    const { queryHandlers, batchHandler } = createHandlerMaps(options);

    // Handle POST for batch requests
    if (c.req.method === METHOD_POST) {
      return handlePostRequest(c, batchHandler);
    }

    // Handle query-based requests (GET/HEAD/DELETE)
    const handler: RequestHandler | undefined = queryHandlers[c.req.method];

    if (!handler) {
      await next();
      return;
    }

    return handleQueryRequest(c, options, handler);
  });
