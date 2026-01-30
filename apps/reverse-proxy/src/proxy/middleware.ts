// Proxy cache middleware
// Execute with bun: wrangler dev

import type { Context, MiddlewareHandler, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { parseIpRotateConfig } from '../ip-rotate/client.ts';
import type { IpRotateConfig, ParsedConfig } from '../ip-rotate/types.ts';
import { logEvent } from './cache.ts';
import {
  DEFAULT_CACHE_VERSION,
  ERROR_MISSING_URL,
  LOG_EVENT_MISSING_QUERY,
  QUERY_KEY_TARGET,
  ROOT_PATH,
  STATUS_BAD_REQUEST,
} from './constants.ts';
import { createErrorResponse, createHandlerMap } from './handlers.ts';
import type {
  ProxyCacheEnv,
  ProxyCacheOptions,
  ProxyCacheStaticOptions,
  RequestHandler,
} from './types.ts';

// Parse IP rotation config from environment
const parseIpRotateConfigFromEnv = (env: ProxyCacheEnv): IpRotateConfig | undefined => {
  const parsed: ParsedConfig = parseIpRotateConfig({
    endpointsJson: env.IP_ROTATE_ENDPOINTS,
    authType: env.IP_ROTATE_AUTH_TYPE,
    apiKey: env.IP_ROTATE_API_KEY,
    accessKeyId: env.IP_ROTATE_AWS_ACCESS_KEY_ID,
    secretAccessKey: env.IP_ROTATE_AWS_SECRET_ACCESS_KEY,
    region: env.IP_ROTATE_AWS_REGION,
  });

  return parsed.success ? parsed.config : undefined;
};

// Create options from environment
const createOptionsFromEnv = (
  staticOptions: ProxyCacheStaticOptions,
  env: ProxyCacheEnv,
  ipRotateCounters: Map<string, number>,
): ProxyCacheOptions => ({
  enableLogging: staticOptions.enableLogging,
  kv: env.KV,
  cacheVersion: env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
  ipRotateConfig: parseIpRotateConfigFromEnv(env),
  ipRotateCounters,
});

// Module-level counter for IP rotation round-robin
const ipRotateCounters: Map<string, number> = new Map();

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
    const handlers: Record<string, RequestHandler> = createHandlerMap(options);
    const handler: RequestHandler | undefined = handlers[c.req.method];

    if (!handler) {
      await next();
      return;
    }

    const target: string | undefined = c.req.query(QUERY_KEY_TARGET);

    if (!target) {
      logEvent(options, LOG_EVENT_MISSING_QUERY, { method: c.req.method });
      return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
    }

    return handler(target);
  });
