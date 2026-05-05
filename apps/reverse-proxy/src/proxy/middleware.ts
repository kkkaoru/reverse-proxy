// Proxy cache middleware
// Execute with bun: wrangler dev

import type { Context, MiddlewareHandler, Next } from 'hono';
import { createMiddleware } from 'hono/factory';
import { getEndpointCount } from '../ip-rotate/client.ts';
import { syncHealthToCounters } from '../ip-rotate/health-sync.ts';
import type { IpRotateConfig } from '../ip-rotate/types.ts';
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
import { createOptionsFromEnv, resolveIpRotateConfig } from './options.ts';
import { createErrorResponse } from './responses.ts';
import type {
  BatchRequestHandler,
  ProxyCacheEnv,
  ProxyCacheOptions,
  ProxyCacheStaticOptions,
  RequestHandler,
} from './types.ts';
import { buildTargetUrl, extractRawQuery } from './url.ts';

interface CachedConfigEntry {
  readonly config: IpRotateConfig;
  readonly cachedAt: number;
}

interface BatchRequestBody {
  readonly urls: readonly string[];
}

// Module-level counter for IP rotation round-robin
const ipRotateCounters: Map<string, number> = new Map();

// Module-level cache for IP rotation config loaded from KV
const ipRotateConfigCache: Map<string, CachedConfigEntry> = new Map();
const IP_ROTATE_CONFIG_KEY: string = 'default';
const CONFIG_CACHE_TTL_MS: number = 300000;

// Check if cached entry is still valid
const isCacheValid = (entry: CachedConfigEntry | undefined): entry is CachedConfigEntry =>
  entry !== undefined && Date.now() - entry.cachedAt < CONFIG_CACHE_TTL_MS;

// Load IP rotation config with TTL-based caching
const getOrLoadIpRotateConfig = async (
  env: ProxyCacheEnv,
  cache: Map<string, CachedConfigEntry>,
): Promise<IpRotateConfig | undefined> => {
  const cached: CachedConfigEntry | undefined = cache.get(IP_ROTATE_CONFIG_KEY);
  if (isCacheValid(cached)) return cached.config;

  const config: IpRotateConfig | undefined = await resolveIpRotateConfig(env);
  if (config) {
    cache.set(IP_ROTATE_CONFIG_KEY, { config, cachedAt: Date.now() });
  }
  return config;
};

// Handle POST batch request
const handlePostRequest = (body: unknown, batchHandler: BatchRequestHandler): Promise<Response> => {
  return batchHandler(body);
};

const parsePostRequestBody = (c: Context): Promise<unknown> => c.req.json().catch((): null => null);

const isBatchRequestBody = (body: unknown): body is BatchRequestBody => {
  if (typeof body !== 'object' || body === null) return false;
  const urlsProperty: PropertyDescriptor | undefined = Object.getOwnPropertyDescriptor(
    body,
    'urls',
  );
  return (
    Array.isArray(urlsProperty?.value) &&
    urlsProperty.value.every((url: unknown): url is string => typeof url === 'string')
  );
};

const getFirstBatchTarget = (body: unknown): string | undefined =>
  isBatchRequestBody(body) ? body.urls[0] : undefined;

const getHealthSyncTarget = (c: Context, postBody: unknown | undefined): string | undefined =>
  c.req.method === METHOD_POST ? getFirstBatchTarget(postBody) : c.req.query(QUERY_KEY_TARGET);

// Sync health state from Durable Object / Cache API into local counters
interface SyncHealthFromDoParams {
  readonly ipRotateConfig: IpRotateConfig | undefined;
  readonly healthCoordinator: DurableObjectNamespace | undefined;
  readonly targetQuery: string | undefined;
}

const syncHealthFromDo = async (params: SyncHealthFromDoParams): Promise<void> => {
  if (!(params.ipRotateConfig && params.healthCoordinator && params.targetQuery)) return;
  try {
    const targetUrl: URL = new URL(params.targetQuery);
    const endpointCount: number = getEndpointCount(params.ipRotateConfig, targetUrl.host);
    if (endpointCount <= 0) return;
    await syncHealthToCounters({
      healthCoordinator: params.healthCoordinator,
      counters: ipRotateCounters,
      domain: targetUrl.host,
      endpointCount,
    });
  } catch {
    // Invalid URL, skip sync
  }
};

// Safely get execution context (throws in test environments without Workers runtime)
const getExecutionCtx = (c: Context): ExecutionContext | undefined => {
  try {
    return c.executionCtx;
  } catch {
    return undefined;
  }
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

    const postBody: unknown | undefined =
      c.req.method === METHOD_POST ? await parsePostRequestBody(c) : undefined;

    const ipRotateConfig: IpRotateConfig | undefined = await getOrLoadIpRotateConfig(
      c.env,
      ipRotateConfigCache,
    );

    // Sync health state from Durable Object / Cache API into local counters
    await syncHealthFromDo({
      ipRotateConfig,
      healthCoordinator: c.env.HEALTH_COORDINATOR,
      targetQuery: getHealthSyncTarget(c, postBody),
    });

    const options: ProxyCacheOptions = {
      ...createOptionsFromEnv({
        staticOptions,
        env: c.env,
        counters: ipRotateCounters,
        ipRotateConfig,
      }),
      executionCtx: getExecutionCtx(c),
    };
    const { queryHandlers, batchHandler } = createHandlerMaps(options);

    // Handle POST for batch requests
    if (c.req.method === METHOD_POST) {
      return handlePostRequest(postBody, batchHandler);
    }

    // Handle query-based requests (GET/HEAD/DELETE)
    const handler: RequestHandler | undefined = queryHandlers[c.req.method];

    if (!handler) {
      await next();
      return;
    }

    return handleQueryRequest(c, options, handler);
  });

export {
  CONFIG_CACHE_TTL_MS,
  getFirstBatchTarget,
  getExecutionCtx,
  getOrLoadIpRotateConfig,
  isCacheValid,
  isBatchRequestBody,
  syncHealthFromDo,
};
export type { CachedConfigEntry, SyncHealthFromDoParams };
