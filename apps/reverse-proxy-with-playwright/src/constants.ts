// Constants for reverse-proxy-with-playwright
// Execute with bun: wrangler dev

import type { ContentfulStatusCode } from 'hono/utils/http-status';

// HTTP Status Codes
export const HTTP_STATUS_OK: ContentfulStatusCode = 200;
export const HTTP_STATUS_BAD_REQUEST: ContentfulStatusCode = 400;
export const HTTP_STATUS_UNAUTHORIZED: ContentfulStatusCode = 401;
export const HTTP_STATUS_NOT_FOUND: ContentfulStatusCode = 404;
export const HTTP_STATUS_INTERNAL_SERVER_ERROR: ContentfulStatusCode = 500;

// Route Paths
export const HEALTHCHECK_PATH = '/healthcheck';
export const ADMIN_HEALTHCHECK_PATH = '/admin/healthcheck';
export const PLAYWRIGHT_HEALTHCHECK_PATH = '/playwright/healthcheck';
export const PLAYWRIGHT_PATH = '/playwright';
export const PLAYWRIGHT_SIGNIN_PATH = '/playwright/signin';

// Service Names
export const SERVICE_NAME_MAIN = 'reverse-proxy-with-playwright';
export const SERVICE_NAME_ADMIN = 'reverse-proxy-with-playwright-admin';
export const SERVICE_NAME_PLAYWRIGHT = 'reverse-proxy-with-playwright-playwright';

// Cache Key Prefixes
export const CACHE_KEY_PREFIX_STORAGE_STATE = 'storage-state';
export const CACHE_KEY_PREFIX_HTML = 'html';

// Password Hashing
export const PBKDF2_ITERATIONS = 10;
export const PBKDF2_KEY_LENGTH = 32;
export const PBKDF2_HASH_ALGORITHM = 'SHA-256';

// Content Types
export const CONTENT_TYPE_JSON = 'application/json';
export const CONTENT_TYPE_HTML = 'text/html';

// Authorization
export const AUTH_HEADER_PREFIX = 'Bearer ';

// Log Prefix
export const LOG_PREFIX = '[reverse-proxy-with-playwright]';

// Browser Timeouts
export const BROWSER_DEFAULT_TIMEOUT_MS = 60000;
export const BROWSER_WAIT_UNTIL_DOMCONTENTLOADED = 'domcontentloaded';
export const BROWSER_WAIT_UNTIL_NETWORKIDLE = 'networkidle';

// Cache Settings
export const CACHE_MAX_AGE_SECONDS = 86400;

// Date Formatting
export const DATE_MONTH_OFFSET = 1;
export const DATE_PAD_LENGTH = 2;
export const DATE_PAD_CHAR = '0';

// Numeric Base
export const HEX_BASE = 16;
export const HEX_PAD_LENGTH = 2;
export const BITS_PER_BYTE = 8;

// Base64 Encoding
export const BASE64_TRIPLET_SIZE = 3;
export const BASE64_6BIT_MASK = 0x3f;
export const BASE64_4BIT_MASK = 0xf;
export const BASE64_2BIT_MASK = 0x3;
export const BASE64_SHIFT_2 = 2;
export const BASE64_SHIFT_4 = 4;
export const BASE64_SHIFT_6 = 6;
