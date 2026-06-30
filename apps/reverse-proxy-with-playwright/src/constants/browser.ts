// Browser constants
// Execute with bun: wrangler dev

export const BROWSER_DEFAULT_TIMEOUT_MS = 30000;
export const BROWSER_WAIT_UNTIL_DOMCONTENTLOADED = 'domcontentloaded';
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

// Cloudflare Browser Rendering's default user-agent advertises
// `HeadlessChrome`, which netkeiba (and many other sites with anti-bot
// rules) silently downgrades to the unauthenticated preview even when
// the request carries valid auth cookies. Override with a stock desktop
// Chrome UA so the upstream treats the proxied session the same as the
// user's real browser. Mirrors the UA used by direct (cookie-mode) fetch
// in apps/sync-realtime-data/src/premium-race.ts.
export const BROWSER_USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36';
