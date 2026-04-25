// Fetch status utilities
// Execute with bun: wrangler dev

import {
  STATUS_CLIENT_ERROR_START,
  STATUS_REDIRECT_END,
  STATUS_REDIRECT_START,
} from '../constants.ts';

// Status codes treated as transient upstream failures
const STATUS_REQUEST_TIMEOUT: number = 408;
const STATUS_TOO_MANY_REQUESTS: number = 429;
const STATUS_SERVER_ERROR_START: number = 500;
const STATUS_WORKER_RESOURCE_EXHAUSTED: number = 533;
const STATUS_EXTENDED_ERROR_END: number = 700;
// AWS API Gateway emits 400 Bad Request when burst-throttled. The upstream
// URL is fine, so the proxy retries via IP rotate to land on a different
// regional gateway with its own throttle bucket.
const STATUS_BAD_REQUEST: number = 400;

// Check if status is cacheable (below 400). 4xx/5xx/6xx/non-standard codes
// like 660 are never written to Cache API or KV.
export const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

// Check if status is a redirect (300-399)
export const isRedirectStatus = (status: number): boolean =>
  status >= STATUS_REDIRECT_START && status < STATUS_REDIRECT_END;

// Check if status indicates a transient upstream failure worth retrying
// via a different API Gateway endpoint (IP rotate). Covers:
//   - 5xx server errors
//   - 6xx non-standard upstream/proxy codes (e.g. 660 from infrastructure)
//   - 429 rate limit
//   - 408 request timeout
//   - 400 Bad Request (AWS API Gateway burst-throttle rejection)
// 533 (Cloudflare Worker resource exhausted) is explicitly excluded since
// rotating IPs cannot fix a local Worker resource constraint.
export const isTransientUpstreamFailureStatus = (status: number): boolean => {
  if (status === STATUS_WORKER_RESOURCE_EXHAUSTED) return false;
  if (status >= STATUS_SERVER_ERROR_START && status < STATUS_EXTENDED_ERROR_END) return true;
  if (status === STATUS_TOO_MANY_REQUESTS) return true;
  if (status === STATUS_REQUEST_TIMEOUT) return true;
  if (status === STATUS_BAD_REQUEST) return true;
  return false;
};
