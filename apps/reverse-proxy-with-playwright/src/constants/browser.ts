// Browser constants
// Execute with bun: wrangler dev

export const BROWSER_DEFAULT_TIMEOUT_MS = 30000;
export const BROWSER_WAIT_UNTIL_DOMCONTENTLOADED = 'domcontentloaded';
// Internal retry budget for fetchPage (total attempts). The page-level fetch
// is the most failure-prone step (browser launch, TLS, upstream 5xx,
// transient CDN/Akamai blips), but callers already retry on their own, so a
// larger budget here multiplies billed browser time. 2 attempts absorb a
// single transient failure; worst case is 2 * BROWSER_DEFAULT_TIMEOUT_MS + 1s.
export const FETCH_PAGE_RETRY_COUNT = 2;
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
