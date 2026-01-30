// HTTP constants
// Execute with bun: wrangler dev

import type { ContentfulStatusCode } from 'hono/utils/http-status';

// HTTP Status Codes
export const HTTP_STATUS_OK: ContentfulStatusCode = 200;
export const HTTP_STATUS_BAD_REQUEST: ContentfulStatusCode = 400;
export const HTTP_STATUS_UNAUTHORIZED: ContentfulStatusCode = 401;
export const HTTP_STATUS_NOT_FOUND: ContentfulStatusCode = 404;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR: ContentfulStatusCode = 500;

// Content Types
export const CONTENT_TYPE_JSON = 'application/json';
export const CONTENT_TYPE_HTML = 'text/html';

// Authorization
export const AUTH_HEADER_PREFIX = 'Bearer ';
