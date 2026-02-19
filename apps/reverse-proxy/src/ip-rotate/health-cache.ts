// Cache API operations for endpoint health state
// Execute with bun: wrangler dev

// Constants at top
const HEALTH_CACHE_NAME: string = 'ip-rotate-health';
const HEALTH_CACHE_TTL_SECONDS: number = 2;
const HEALTH_CACHE_URL_PREFIX: string = 'https://health-cache.internal/';
const CONTENT_TYPE_JSON: string = 'application/json';
const LOG_PREFIX: string = '[ip-rotate]';

// Build cache URL for a given domain
const buildCacheUrl = (domain: string): string => `${HEALTH_CACHE_URL_PREFIX}${domain}`;

// Read health state from Cache API
const readHealthFromCache = async (domain: string): Promise<Record<string, number> | null> => {
  try {
    const cache: Cache = await caches.open(HEALTH_CACHE_NAME);
    const response: Response | undefined = await cache.match(buildCacheUrl(domain));
    if (!response) {
      // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
      console.log(LOG_PREFIX, { event: 'health-cache-miss', domain });
      return null;
    }
    const data: Record<string, number> = await response.json();
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'health-cache-hit',
      domain,
      keyCount: Object.keys(data).length,
    });
    return data;
  } catch {
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, { event: 'health-cache-miss', domain });
    return null;
  }
};

// Write health state to Cache API
const writeHealthToCache = async (domain: string, state: Record<string, number>): Promise<void> => {
  try {
    const cache: Cache = await caches.open(HEALTH_CACHE_NAME);
    const body: string = JSON.stringify(state);
    const response: Response = new Response(body, {
      headers: {
        'Content-Type': CONTENT_TYPE_JSON,
        'Cache-Control': `max-age=${HEALTH_CACHE_TTL_SECONDS}`,
      },
    });
    await cache.put(buildCacheUrl(domain), response);
    // biome-ignore lint/suspicious/noConsole: Intentional logging for wrangler tail observability
    console.log(LOG_PREFIX, {
      event: 'health-cache-write',
      domain,
      keyCount: Object.keys(state).length,
      ttlSeconds: HEALTH_CACHE_TTL_SECONDS,
    });
  } catch {
    // Silently ignore cache write errors
  }
};

export {
  buildCacheUrl,
  CONTENT_TYPE_JSON,
  HEALTH_CACHE_NAME,
  HEALTH_CACHE_TTL_SECONDS,
  HEALTH_CACHE_URL_PREFIX,
  readHealthFromCache,
  writeHealthToCache,
};
