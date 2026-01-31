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

// Constants
const FORWARD_PARAMS: readonly string[] = ['word'];
const QUERY_STRING_START_INDEX: number = 1;
const QUERY_SEPARATOR_INITIAL: string = '?';
const QUERY_SEPARATOR_APPEND: string = '&';

// Module-level counter for IP rotation round-robin
const ipRotateCounters: Map<string, number> = new Map();

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
  counters: Map<string, number>,
): ProxyCacheOptions => ({
  enableLogging: staticOptions.enableLogging,
  enableCacheApi: env.ENABLE_CACHE_API === 'true',
  kv: env.KV,
  cacheVersion: env.CACHE_VERSION ?? DEFAULT_CACHE_VERSION,
  ipRotateConfig: parseIpRotateConfigFromEnv(env),
  ipRotateCounters: counters,
});

// Extract raw parameter value from query string (preserves original encoding like EUC-JP)
const extractRawParamValue = (rawQuery: string, paramName: string): string | undefined => {
  const pattern: RegExp = new RegExp(`(?:^|&)${paramName}=([^&]*)`, 'i');
  const match: RegExpMatchArray | null = rawQuery.match(pattern);
  return match?.[1];
};

// Check if URL already has the specified parameter
const urlHasParam = (url: string, param: string): boolean => {
  try {
    return new URL(url).searchParams.has(param);
  } catch {
    return true; // Treat invalid URLs as having the param to skip appending
  }
};

// Get query separator based on whether URL already has query string
const getQuerySeparator = (url: string): string =>
  url.includes(QUERY_SEPARATOR_INITIAL) ? QUERY_SEPARATOR_APPEND : QUERY_SEPARATOR_INITIAL;

// Append single parameter to URL if conditions are met
const appendParamIfNeeded = (url: string, rawQuery: string, param: string): string => {
  const rawValue: string | undefined = extractRawParamValue(rawQuery, param);
  if (rawValue === undefined) {
    return url;
  }
  if (urlHasParam(url, param)) {
    return url;
  }
  const separator: string = getQuerySeparator(url);
  return `${url}${separator}${param}=${rawValue}`;
};

// Build target URL by appending forwarded parameters from proxy request
const buildTargetUrl = (baseUrl: string, rawProxyQuery: string): string =>
  FORWARD_PARAMS.reduce(
    (url: string, param: string): string => appendParamIfNeeded(url, rawProxyQuery, param),
    baseUrl,
  );

// Extract raw query string from request URL
const extractRawQuery = (requestUrl: string): string =>
  new URL(requestUrl).search.slice(QUERY_STRING_START_INDEX);

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

    const baseTarget: string | undefined = c.req.query(QUERY_KEY_TARGET);

    if (!baseTarget) {
      logEvent(options, LOG_EVENT_MISSING_QUERY, { method: c.req.method });
      return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
    }

    const rawProxyQuery: string = extractRawQuery(c.req.url);
    const target: string = buildTargetUrl(baseTarget, rawProxyQuery);

    return handler(target);
  });
