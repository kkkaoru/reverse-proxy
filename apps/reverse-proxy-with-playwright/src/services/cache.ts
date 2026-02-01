// Cache service for HTML caching using KV
// Execute with bun: wrangler dev

import { DATE_MONTH_OFFSET, DATE_PAD_CHAR, DATE_PAD_LENGTH } from '../constants/index.ts';

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

const isCacheResponse = (data: RawCacheData): data is CacheResponse =>
  typeof data.html === 'string' && typeof data.cachedAt === 'string';

export const getCachedHtml = async (
  kv: KVNamespace,
  params: CacheKeyParams,
): Promise<CacheResponse | null> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);

  const cachedJson: string | null = await kv.get(cacheKey);

  if (!cachedJson) {
    return null;
  }

  try {
    const data: RawCacheData = JSON.parse(cachedJson);

    if (!isCacheResponse(data)) {
      return null;
    }

    return data;
  } catch {
    return null;
  }
};

export const setCachedHtml = async (
  kv: KVNamespace,
  params: CacheKeyParams,
  html: string,
): Promise<void> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);

  const cacheData: CacheResponse = {
    html,
    cachedAt: new Date().toISOString(),
  };

  await kv.put(cacheKey, JSON.stringify(cacheData));
};

export const deleteCachedHtml = async (
  kv: KVNamespace,
  params: CacheKeyParams,
): Promise<boolean> => {
  const dateKey: string = formatDateKey(new Date());
  const cacheKey: string = buildCacheKey(params, dateKey);

  const existing: string | null = await kv.get(cacheKey);
  if (existing) {
    await kv.delete(cacheKey);
    return true;
  }
  return false;
};

export const buildCacheKeyForTest = (params: CacheKeyParams, dateKey: string): string =>
  buildCacheKey(params, dateKey);

export const formatDateKeyForTest = (date: Date): string => formatDateKey(date);
