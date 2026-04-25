// Browser constants
// Execute with bun: wrangler dev

export const BROWSER_DEFAULT_TIMEOUT_MS = 30000;
export const BROWSER_WAIT_UNTIL_DOMCONTENTLOADED = 'domcontentloaded';
export const BROWSER_WAIT_UNTIL_NETWORKIDLE = 'networkidle';
// Internal retry budget for fetchPage. The page-level fetch is the most
// failure-prone step (browser launch, TLS, upstream 5xx, transient
// CDN/Akamai blips), so we allow several attempts before surfacing an
// error to the client. Worst case attempts * BROWSER_DEFAULT_TIMEOUT_MS +
// backoff stays within the Worker CPU budget (cpu_ms = 300_000).
export const FETCH_PAGE_RETRY_COUNT = 4;
export const FETCH_PAGE_RETRY_BASE_DELAY_MS = 1000;
// Empty page detection: Cloudflare Browser sometimes returns success with
// an empty HTML body (upstream wiped via JS or aborted before parse).
// Treat those as transient failures so the retry loop can take another
// shot rather than caching/serving empty content.
export const EMPTY_PAGE_CONTENT_ERROR = 'Empty page content from browser';
