// Proxy request handlers
// Execute with bun: wrangler dev

import { convertResponseToUtf8 } from '../utils/encoding.ts';
import {
  createCacheKey,
  createKvCacheKey,
  deleteKvCache,
  logEvent,
  tryGetKvCache,
} from './cache.ts';
import {
  ERROR_INVALID_URL,
  ERROR_UNKNOWN_FETCH,
  LOG_EVENT_CACHE_HIT,
  LOG_EVENT_CACHE_MISS,
  LOG_EVENT_DELETE,
  LOG_EVENT_FETCH_ERROR,
  LOG_EVENT_FETCH_STATUS,
  LOG_EVENT_INVALID_URL,
  STATUS_BAD_GATEWAY,
  STATUS_BAD_REQUEST,
  STATUS_NOT_FOUND,
  STATUS_OK,
} from './constants.ts';
import { fetchAndCache } from './fetch.ts';
import { createErrorResponse, createJsonResponse } from './responses.ts';
import type { ParsedUrl, ProxyCacheOptions, RequestHandler } from './types.ts';

// Re-export response creators for backwards compatibility
export { createErrorResponse, createJsonResponse } from './responses.ts';

// URL parsing
export const parseTargetUrl = (raw: string): ParsedUrl => {
  try {
    return { success: true, value: new URL(raw) };
  } catch {
    return { success: false, message: ERROR_INVALID_URL };
  }
};

// Error message extraction
export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ERROR_UNKNOWN_FETCH;

// Handle proxy GET/HEAD request
export const handleProxyRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed: ParsedUrl = parseTargetUrl(target);

  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }

  const kvCacheKey: string = createKvCacheKey(parsed.value.toString(), options.cacheVersion);
  const kvCached: Response | null = await tryGetKvCache(options, target, kvCacheKey);

  if (kvCached) {
    return convertResponseToUtf8(kvCached);
  }

  const cacheKey: string = createCacheKey(parsed.value, new Date());
  const cached: Response | undefined = await caches.default.match(cacheKey);

  if (cached) {
    logEvent(options, LOG_EVENT_CACHE_HIT, { target });
    return convertResponseToUtf8(cached.clone());
  }

  logEvent(options, LOG_EVENT_CACHE_MISS, { target });

  try {
    const upstreamResponse: Response = await fetchAndCache({
      cacheKey,
      kvCacheKey,
      target: parsed.value,
      options,
    });
    logEvent(options, LOG_EVENT_FETCH_STATUS, { target, status: upstreamResponse.status });
    return convertResponseToUtf8(upstreamResponse);
  } catch (error: unknown) {
    const message: string = getErrorMessage(error);
    logEvent(options, LOG_EVENT_FETCH_ERROR, { target, error: message });
    return createErrorResponse(`Upstream fetch failed: ${message}`, STATUS_BAD_GATEWAY);
  }
};

// Handle DELETE request
export const handleDeleteRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed: ParsedUrl = parseTargetUrl(target);

  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }

  const cacheKey: string = createCacheKey(parsed.value, new Date());
  const kvCacheKey: string = createKvCacheKey(parsed.value.toString(), options.cacheVersion);

  const cacheDeleted: boolean = await caches.default.delete(cacheKey);
  const kvDeleted: boolean = await deleteKvCache(options.kv, kvCacheKey);
  const deleted: boolean = cacheDeleted || kvDeleted;
  const status: number = deleted ? STATUS_OK : STATUS_NOT_FOUND;

  logEvent(options, LOG_EVENT_DELETE, { target, deleted, cacheDeleted, kvDeleted });
  return createJsonResponse({ deleted, cacheDeleted, kvDeleted }, status);
};

// Create handler map
export const createHandlerMap = (options: ProxyCacheOptions): Record<string, RequestHandler> => ({
  GET: (target: string): Promise<Response> => handleProxyRequest(target, options),
  HEAD: (target: string): Promise<Response> => handleProxyRequest(target, options),
  DELETE: (target: string): Promise<Response> => handleDeleteRequest(target, options),
});
