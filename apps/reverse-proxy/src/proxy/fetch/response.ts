// Fetch response processing
// Execute with bun: wrangler dev

import { cacheResponse, logEvent, storeInKvCache } from '../cache.ts';
import { ERROR_BODY_SLICE_LENGTH, LOG_EVENT_UPSTREAM_ERROR } from '../constants.ts';
import type { LogUpstreamErrorParams, ProcessFetchResponseParams } from '../types.ts';
import { isCacheableStatus } from './status.ts';

// Log upstream error with response body
export const logUpstreamError = async (params: LogUpstreamErrorParams): Promise<void> => {
  const errorBody: string = await params.response.clone().text();
  logEvent(params.options, LOG_EVENT_UPSTREAM_ERROR, {
    target: params.target.toString(),
    finalUrl: params.currentUrl,
    status: params.response.status,
    body: errorBody.slice(0, ERROR_BODY_SLICE_LENGTH),
  });
};

// Process fetch response - handle caching for successful responses
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
    });
    return response;
  }

  if (params.options.enableCacheApi) {
    await cacheResponse(params.cacheKey, response);
  }
  await storeInKvCache(params, response);
  return response;
};
