// Proxy cache constants
// Execute with bun: wrangler dev

// Routes
export const ROOT_PATH: string = '/';
export const QUERY_KEY_TARGET: string = 'url';

// HTTP Methods
export const METHOD_GET: string = 'GET';
export const METHOD_HEAD: string = 'HEAD';
export const METHOD_DELETE: string = 'DELETE';

// Request options
export const CACHE_MODE_NO_STORE: RequestCache = 'no-store';
export const REDIRECT_MANUAL: RequestRedirect = 'manual';

// Headers
export const HEADER_CONTENT_TYPE: string = 'content-type';
export const HEADER_USER_AGENT: string = 'user-agent';
export const HEADER_ACCEPT: string = 'accept';
export const HEADER_ACCEPT_LANGUAGE: string = 'accept-language';
export const HEADER_ACCEPT_ENCODING: string = 'accept-encoding';
export const HEADER_REFERER: string = 'referer';
export const HEADER_CONNECTION: string = 'connection';
export const HEADER_UPGRADE_INSECURE_REQUESTS: string = 'upgrade-insecure-requests';
export const HEADER_SEC_FETCH_DEST: string = 'sec-fetch-dest';
export const HEADER_SEC_FETCH_MODE: string = 'sec-fetch-mode';
export const HEADER_SEC_FETCH_SITE: string = 'sec-fetch-site';
export const HEADER_SEC_FETCH_USER: string = 'sec-fetch-user';
export const HEADER_LOCATION: string = 'location';
export const HEADER_SET_COOKIE: string = 'set-cookie';

// Default header values
export const DEFAULT_USER_AGENT: string =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';
export const DEFAULT_ACCEPT: string =
  'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8';
export const DEFAULT_ACCEPT_LANGUAGE: string = 'ja,en-US;q=0.9,en;q=0.8';
export const DEFAULT_ACCEPT_ENCODING: string = 'gzip, deflate, br';
export const CONTENT_TYPE_JSON: string = 'application/json; charset=utf-8';
export const CONNECTION_KEEP_ALIVE: string = 'keep-alive';
export const SEC_FETCH_DEST_DOCUMENT: string = 'document';
export const SEC_FETCH_MODE_NAVIGATE: string = 'navigate';
export const SEC_FETCH_SITE_NONE: string = 'none';
export const SEC_FETCH_USER_TRUE: string = '?1';
export const UPGRADE_INSECURE_TRUE: string = '1';

// HTTP Status codes
export const STATUS_OK: number = 200;
export const STATUS_REDIRECT_START: number = 300;
export const STATUS_REDIRECT_END: number = 400;
export const STATUS_BAD_REQUEST: number = 400;
export const STATUS_NOT_FOUND: number = 404;
export const STATUS_CLIENT_ERROR_START: number = 400;
export const STATUS_BAD_GATEWAY: number = 502;

// Limits
export const MAX_REDIRECTS: number = 10;
export const ERROR_BODY_SLICE_LENGTH: number = 500;

// Error messages
export const ERROR_MISSING_URL: string = 'Query parameter "url" is required.';
export const ERROR_INVALID_URL: string = 'Query parameter "url" must be a valid absolute URL.';
export const ERROR_TOO_MANY_REDIRECTS: string = 'Too many redirects';
export const ERROR_UNKNOWN_FETCH: string = 'Unknown fetch error';

// Logging
export const LOG_PREFIX: string = '[reverse-proxy]';
export const LOG_EVENT_CACHE_HIT: string = 'cache-hit';
export const LOG_EVENT_CACHE_MISS: string = 'cache-miss';
export const LOG_EVENT_FETCH_STATUS: string = 'fetch-status';
export const LOG_EVENT_DELETE: string = 'cache-delete';
export const LOG_EVENT_INVALID_URL: string = 'invalid-url';
export const LOG_EVENT_MISSING_QUERY: string = 'missing-url-query';
export const LOG_EVENT_FETCH_ERROR: string = 'fetch-error';
export const LOG_EVENT_UPSTREAM_ERROR: string = 'upstream-error';
export const LOG_EVENT_KV_CACHE_HIT: string = 'kv-cache-hit';
export const LOG_EVENT_KV_CACHE_MISS: string = 'kv-cache-miss';
export const LOG_EVENT_KV_CACHE_SET: string = 'kv-cache-set';
export const LOG_EVENT_IP_ROTATE: string = 'ip-rotate';

// Cache settings
export const CACHE_TTL_SECONDS: number = 432000; // 5 days (86400 * 5)
export const KV_CACHE_KEY_PREFIX: string = 'proxy';
export const DEFAULT_CACHE_VERSION: string = 'v1';
