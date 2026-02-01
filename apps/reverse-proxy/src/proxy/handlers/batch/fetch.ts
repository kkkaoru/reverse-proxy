// Batch single URL fetch
// Execute with bun: wrangler dev

import { convertResponseToUtf8 } from '../../../utils/encoding.ts';
import { createKvCacheKey, logEvent, setKvCachedContent, tryGetKvCache } from '../../cache.ts';
import {
  ERROR_FETCH_FAILED,
  HEADER_CONTENT_TYPE,
  LOG_EVENT_KV_CACHE_SET,
  RESULT_CACHE_HIT,
  RESULT_ERROR,
  RESULT_SSRF_BLOCKED,
  RESULT_SUCCESS,
  STATUS_BAD_GATEWAY,
  STATUS_CLIENT_ERROR_START,
  STATUS_OK,
  STATUS_UNPROCESSABLE_ENTITY,
} from '../../constants.ts';
import { performFetch } from '../../fetch/core.ts';
import { buildFetchHeaders } from '../../fetch/headers.ts';
import { isCacheableStatus } from '../../fetch/status.ts';
import type {
  BatchFetchResult,
  BatchResultStatus,
  ProxyCacheOptions,
  SingleFetchParams,
  SsrfValidationResult,
} from '../../types.ts';
import { validateUrlWithSsrf } from '../../url.ts';

// Try to get cached result from KV
const tryGetCachedResult = async (
  url: string,
  options: ProxyCacheOptions,
): Promise<BatchFetchResult | null> => {
  const kvCacheKey: string = createKvCacheKey(url, options.cacheVersion);
  const cached: Response | null = await tryGetKvCache(options, url, kvCacheKey);

  if (!cached) {
    return null;
  }

  const body: string = await cached.text();
  const contentType: string = cached.headers.get(HEADER_CONTENT_TYPE) ?? '';

  return {
    url,
    httpStatus: STATUS_OK,
    result: RESULT_CACHE_HIT,
    body,
    contentType,
  };
};

interface StoreInKvCacheParams {
  url: string;
  body: string;
  contentType: string;
  options: ProxyCacheOptions;
}

// Store successful response in KV cache
const storeInKvCacheForBatch = async (params: StoreInKvCacheParams): Promise<void> => {
  if (!params.options.kv) {
    return;
  }

  const kvCacheKey: string = createKvCacheKey(params.url, params.options.cacheVersion);

  await setKvCachedContent({
    kv: params.options.kv,
    cacheKey: kvCacheKey,
    data: { content: params.body, contentType: params.contentType },
  });

  logEvent(params.options, LOG_EVENT_KV_CACHE_SET, { target: params.url, cacheKey: kvCacheKey });
};

// Fetch single URL with SSRF validation and caching
export const fetchSingleUrl = async (params: SingleFetchParams): Promise<BatchFetchResult> => {
  const validation: SsrfValidationResult = validateUrlWithSsrf(params.url);

  if (!validation.valid) {
    return {
      url: params.url,
      httpStatus: STATUS_UNPROCESSABLE_ENTITY,
      result: RESULT_SSRF_BLOCKED,
      body: validation.reason,
    };
  }

  // Try KV cache first
  const cachedResult: BatchFetchResult | null = await tryGetCachedResult(
    params.url,
    params.options,
  );

  if (cachedResult) {
    return cachedResult;
  }

  const headers: Record<string, string> = buildFetchHeaders(validation.url.origin);

  try {
    const response: Response = await performFetch(params.options, params.url, headers);
    const converted: Response = await convertResponseToUtf8(response);
    const body: string = await converted.text();
    const contentType: string = converted.headers.get(HEADER_CONTENT_TYPE) ?? '';
    const result: BatchResultStatus =
      response.status < STATUS_CLIENT_ERROR_START ? RESULT_SUCCESS : RESULT_ERROR;

    // Store in KV cache if response is cacheable
    if (isCacheableStatus(response.status)) {
      await storeInKvCacheForBatch({ url: params.url, body, contentType, options: params.options });
    }

    return { url: params.url, httpStatus: response.status, result, body };
  } catch {
    return {
      url: params.url,
      httpStatus: STATUS_BAD_GATEWAY,
      result: RESULT_ERROR,
      body: ERROR_FETCH_FAILED,
    };
  }
};
