// Batch request handler
// Execute with bun: wrangler dev

import {
  ERROR_INVALID_BODY,
  ERROR_MISSING_URLS,
  STATUS_BAD_REQUEST,
  STATUS_OK,
} from '../../constants.ts';
import { createErrorResponse, createJsonResponse } from '../../responses.ts';
import type { BatchFetchResult, ProxyCacheOptions } from '../../types.ts';
import { executeBatchFetch } from './execution.ts';

// Check if body is valid batch request
const isValidBatchRequestBody = (body: unknown): body is { urls: readonly string[] } =>
  typeof body === 'object' &&
  body !== null &&
  'urls' in body &&
  Array.isArray((body as { urls: unknown }).urls);

// Handle batch request
export const handleBatchRequest = async (
  body: unknown,
  options: ProxyCacheOptions,
): Promise<Response> => {
  if (!isValidBatchRequestBody(body)) {
    const message: string =
      typeof body === 'object' && body !== null ? ERROR_MISSING_URLS : ERROR_INVALID_BODY;
    return createErrorResponse(message, STATUS_BAD_REQUEST);
  }

  const results: readonly BatchFetchResult[] = await executeBatchFetch({
    urls: body.urls,
    options,
  });

  return createJsonResponse(results, STATUS_OK);
};
