// Proxy GET/HEAD request handler
// Execute with bun: wrangler dev

import { convertResponseToUtf8 } from '../../utils/encoding.ts';
import { createCacheKey, createKvCacheKey, logEvent, tryGetKvCache } from '../cache.ts';
import {
  LOG_EVENT_CACHE_HIT,
  LOG_EVENT_CACHE_MISS,
  LOG_EVENT_FETCH_ERROR,
  LOG_EVENT_FETCH_STATUS,
  LOG_EVENT_INVALID_URL,
  STATUS_BAD_GATEWAY,
  STATUS_BAD_REQUEST,
} from '../constants.ts';
import { getErrorMessage } from '../errors.ts';
import { fetchAndCache } from '../fetch.ts';
import { createErrorResponse } from '../responses.ts';
import type { ParsedUrl, ProxyCacheOptions } from '../types.ts';
import { parseTargetUrl } from '../url.ts';

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

  if (options.enableCacheApi) {
    const cached: Response | undefined = await caches.default.match(cacheKey);

    if (cached) {
      logEvent(options, LOG_EVENT_CACHE_HIT, { target });
      return convertResponseToUtf8(cached.clone());
    }
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
