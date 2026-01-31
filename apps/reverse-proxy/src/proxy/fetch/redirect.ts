// Redirect handling utilities
// Execute with bun: wrangler dev

import { logEvent } from '../cache.ts';
import {
  ERROR_TOO_MANY_REDIRECTS,
  HEADER_LOCATION,
  LOG_EVENT_UPSTREAM_ERROR,
  STATUS_BAD_GATEWAY,
} from '../constants.ts';
import { createErrorResponse } from '../responses.ts';
import type { ProxyCacheOptions } from '../types.ts';

// Handle redirect - extract new URL from response Location header
export const handleRedirect = (response: Response, currentUrl: string): string | null => {
  const location: string | null = response.headers.get(HEADER_LOCATION);
  if (!location) {
    return null;
  }
  return new URL(location, currentUrl).toString();
};

// Create error response for too many redirects
export const createTooManyRedirectsResponse = (
  options: ProxyCacheOptions,
  target: URL,
): Response => {
  logEvent(options, LOG_EVENT_UPSTREAM_ERROR, {
    target: target.toString(),
    error: ERROR_TOO_MANY_REDIRECTS,
  });
  return createErrorResponse(ERROR_TOO_MANY_REDIRECTS, STATUS_BAD_GATEWAY);
};
