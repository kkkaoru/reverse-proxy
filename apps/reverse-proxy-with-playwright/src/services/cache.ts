// Cache service for HTML caching using Cache API
// Execute with bun: wrangler dev

import {
  CACHE_MAX_AGE_SECONDS,
  DATE_MONTH_OFFSET,
  DATE_PAD_CHAR,
  DATE_PAD_LENGTH,
} from '../constants/index.ts';

interface CacheKeyParams {
  url: string;
  userId: string;
}

interface CacheResponse {
  html: string;
  cachedAt: string;
}

interface RawCacheData {
  html?: unknown;
  cachedAt?: unknown;
}

const CACHE_NAME = 'html-cache';
const CACHE_INTERNAL_URL_PREFIX = 'https://cache.internal/';

const formatDateKey = (date: Date): string => {
  const year: number = date.getUTCFullYear();
  const month: string = String(date.getUTCMonth() + DATE_MONTH_OFFSET).padStart(
    DATE_PAD_LENGTH,
    DATE_PAD_CHAR,
  );
  const day: string = String(date.getUTCDate()).padStart(DATE_PAD_LENGTH, DATE_PAD_CHAR);
  return `${year}-${month}-${day}`;
};

const buildCacheKey = (params: CacheKeyParams, dateKey: string): string =>
  `html::${params.url}::${params.userId}::${dateKey}`;

const buildCacheUrl = (cacheKey: string): string =>
  `${CACHE_INTERNAL_URL_PREFIX}${encodeURIComponent(cacheKey)}`;

const isCacheResponse = (data: RawCacheData): data is CacheResponse =>
  typeof data.html === 'string' && typeof data.cachedAt === 'string';

export const getCachedHtml = async (params: CacheKeyParams): Promise<CacheResponse | null> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);
  const cacheUrl: string = buildCacheUrl(cacheKey);

  const cache: Cache = await caches.open(CACHE_NAME);
  const cachedResponse: Response | undefined = await cache.match(cacheUrl);

  if (!cachedResponse) {
    return null;
  }

  const data: RawCacheData = await cachedResponse.json();

  if (!isCacheResponse(data)) {
    return null;
  }

  return data;
};

export const setCachedHtml = async (params: CacheKeyParams, html: string): Promise<void> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);
  const cacheUrl: string = buildCacheUrl(cacheKey);

  const cacheData: CacheResponse = {
    html,
    cachedAt: new Date().toISOString(),
  };

  const response: Response = new Response(JSON.stringify(cacheData), {
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': `max-age=${CACHE_MAX_AGE_SECONDS}`,
    },
  });

  const cache: Cache = await caches.open(CACHE_NAME);
  await cache.put(cacheUrl, response);
};

export const deleteCachedHtml = async (params: CacheKeyParams): Promise<boolean> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);
  const cacheUrl: string = buildCacheUrl(cacheKey);

  const cache: Cache = await caches.open(CACHE_NAME);
  return cache.delete(cacheUrl);
};

export const buildCacheKeyForTest = (params: CacheKeyParams, dateKey: string): string =>
  buildCacheKey(params, dateKey);

export const formatDateKeyForTest = (date: Date): string => formatDateKey(date);
