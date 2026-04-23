// Fetch response processing
// Execute with bun: wrangler dev

import type { Utf8TextResult } from '../../utils/encoding.ts';
import { convertResponseToUtf8Text } from '../../utils/encoding.ts';
import { logEvent, sanitizeResponseHeaders, storeKvCacheFromText } from '../cache.ts';
import { ERROR_BODY_SLICE_LENGTH, LOG_EVENT_UPSTREAM_ERROR } from '../constants.ts';
import type {
  FetchAndCacheParams,
  LogUpstreamErrorParams,
  ProcessFetchResponseParams,
} from '../types.ts';
import { isAkamaiBlockBody } from './akamai.ts';
import { isCacheableStatus } from './status.ts';

// Log upstream error with response body (skip body buffering when logging disabled)
export const logUpstreamError = async (params: LogUpstreamErrorParams): Promise<void> => {
  if (!params.enableLogging) return;
  const errorBody: string = await params.response.clone().text();
  logEvent(params.options, LOG_EVENT_UPSTREAM_ERROR, {
    target: params.target.toString(),
    finalUrl: params.currentUrl,
    status: params.response.status,
    body: errorBody.slice(0, ERROR_BODY_SLICE_LENGTH),
  });
};

// Defer KV cache write using waitUntil when available
export const storeKvCacheDeferred = (
  params: FetchAndCacheParams,
  converted: Utf8TextResult,
): void => {
  if (!params.options.kv) return;
  const promise: Promise<void> = storeKvCacheFromText(
    params,
    converted.text,
    converted.contentType,
  );
  if (params.options.executionCtx) {
    params.options.executionCtx.waitUntil(promise);
    return;
  }
  promise.catch(() => {});
};

// Process fetch response - read body once, cache, and return
export const processFetchResponse = async (
  processParams: ProcessFetchResponseParams,
): Promise<Response> => {
  const { params, response, currentUrl } = processParams;

  if (!isCacheableStatus(response.status)) {
    await logUpstreamError({
      options: params.options,
      target: params.target,
      currentUrl,
      response,
      enableLogging: params.options.enableLogging,
    });
    return response;
  }

  // Read body once and convert to UTF-8 text
  const converted: Utf8TextResult = await convertResponseToUtf8Text(response);

  // Skip caching and surface upstream error if body is an Akamai block page
  // wrapped in HTTP 200 (Akamai error pages are served with 200 through the
  // IP rotate AWS API Gateway regardless of upstream 403).
  if (isAkamaiBlockBody(converted.text)) {
    // biome-ignore lint/suspicious/noConsole: observability for Akamai block mitigation
    console.log('[proxy]', {
      event: 'akamai-block-not-cached',
      target: params.target.toString(),
      finalUrl: currentUrl,
      status: converted.status,
    });
    return new Response(converted.text, {
      status: converted.status,
      statusText: converted.statusText,
      headers: converted.headers,
    });
  }

  // Cache API: build response from text and store
  if (params.options.enableCacheApi) {
    const cacheHeaders: Headers = sanitizeResponseHeaders(converted);
    const cacheable: Response = new Response(converted.text, {
      headers: cacheHeaders,
      status: converted.status,
      statusText: converted.statusText,
    });
    await caches.default.put(params.cacheKey, cacheable);
  }

  // KV: deferred write via waitUntil
  storeKvCacheDeferred(params, converted);

  // Return client response
  return new Response(converted.text, {
    status: converted.status,
    statusText: converted.statusText,
    headers: converted.headers,
  });
};
