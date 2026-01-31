// Proxy cache operations
// Execute with bun: wrangler dev

import { convertResponseToUtf8 } from '../utils/encoding.ts';
import {
  CACHE_TTL_SECONDS,
  HEADER_CONTENT_TYPE,
  HEADER_SET_COOKIE,
  KV_CACHE_KEY_PREFIX,
  LOG_EVENT_KV_CACHE_HIT,
  LOG_EVENT_KV_CACHE_MISS,
  LOG_EVENT_KV_CACHE_SET,
  STATUS_OK,
} from './constants.ts';
import type {
  CachedContent,
  FetchAndCacheParams,
  LogEventDetail,
  ProxyCacheOptions,
  SetKvCacheParams,
} from './types.ts';

// Logging
export const logEvent = (
  options: ProxyCacheOptions,
  message: string,
  detail: LogEventDetail,
): void => {
  if (!options.enableLogging) {
    return;
  }
  // biome-ignore lint/suspicious/noConsole: explicit logging requested for observability.
  console.log('[reverse-proxy]', message, detail);
};

// Cache key generation
export const formatKeyDate = (date: Date): string => {
  const [datePart] = date.toISOString().split('T');
  return datePart ?? '';
};

export const createCacheKey = (target: URL, date: Date): string =>
  `${target.toString()}::${formatKeyDate(date)}`;

export const createKvCacheKey = (url: string, cacheVersion: string): string =>
  `${KV_CACHE_KEY_PREFIX}-${cacheVersion}::${url}`;

// KV cache operations
export const parseKvCachedContent = (cached: string): CachedContent => JSON.parse(cached);

export const getKvCachedContent = async (
  kv: KVNamespace,
  cacheKey: string,
): Promise<CachedContent | null> => {
  const cached: string | null = await kv.get(cacheKey, 'text');
  return cached ? parseKvCachedContent(cached) : null;
};

export const setKvCachedContent = (params: SetKvCacheParams): Promise<void> =>
  params.kv.put(params.cacheKey, JSON.stringify(params.data), {
    expirationTtl: CACHE_TTL_SECONDS,
  });

// Response header sanitization
export const sanitizeResponseHeaders = (response: Response): Headers => {
  const headers: Headers = new Headers(response.headers);
  headers.delete(HEADER_SET_COOKIE);
  return headers;
};

// Cache API operations
export const cacheResponse = async (cacheKey: string, response: Response): Promise<void> => {
  const responseForCache: Response = response.clone();
  const cacheable: Response = new Response(responseForCache.body, {
    headers: sanitizeResponseHeaders(responseForCache),
    status: responseForCache.status,
    statusText: responseForCache.statusText,
  });
  await caches.default.put(cacheKey, cacheable);
};

// Store response in KV cache
export const storeInKvCache = async (
  params: FetchAndCacheParams,
  response: Response,
): Promise<void> => {
  if (!params.options.kv) {
    return;
  }

  const convertedResponse: Response = await convertResponseToUtf8(response.clone());
  const content: string = await convertedResponse.text();
  const contentType: string = convertedResponse.headers.get(HEADER_CONTENT_TYPE) ?? '';

  await setKvCachedContent({
    kv: params.options.kv,
    cacheKey: params.kvCacheKey,
    data: { content, contentType },
  });

  logEvent(params.options, LOG_EVENT_KV_CACHE_SET, {
    target: params.target.toString(),
    cacheKey: params.kvCacheKey,
  });
};

// Create response from cached content
export const createKvCacheResponse = (cached: CachedContent): Response =>
  new Response(cached.content, {
    status: STATUS_OK,
    headers: { [HEADER_CONTENT_TYPE]: cached.contentType },
  });

// Try to get cached response from KV
export const tryGetKvCache = async (
  options: ProxyCacheOptions,
  target: string,
  kvCacheKey: string,
): Promise<Response | null> => {
  if (!options.kv) {
    return null;
  }

  const cached: CachedContent | null = await getKvCachedContent(options.kv, kvCacheKey);

  if (!cached) {
    logEvent(options, LOG_EVENT_KV_CACHE_MISS, { target, cacheKey: kvCacheKey });
    return null;
  }

  logEvent(options, LOG_EVENT_KV_CACHE_HIT, { target, cacheKey: kvCacheKey });
  return createKvCacheResponse(cached);
};

// Delete KV cache
export const deleteKvCache = async (
  kv: KVNamespace | undefined,
  kvCacheKey: string,
): Promise<boolean> => {
  if (!kv) {
    return false;
  }
  const existing: string | null = await kv.get(kvCacheKey, 'text');
  if (!existing) {
    return false;
  }
  await kv.delete(kvCacheKey);
  return true;
};

// Delete KV cache by prefix - returns deleted keys
export interface PrefixDeleteResult {
  readonly deletedCount: number;
  readonly deletedKeys: readonly string[];
}

interface DeletePageParams {
  readonly kv: KVNamespace;
  readonly prefix: string;
  readonly cursor: string | undefined;
  readonly accumulator: readonly string[];
}

// Delete keys from a single page and return updated accumulator
const deleteKeysFromPage = async (
  kv: KVNamespace,
  keys: readonly { name: string }[],
): Promise<readonly string[]> => {
  const keyNames: readonly string[] = keys.map((key: { name: string }): string => key.name);
  await Promise.all(keyNames.map((name: string): Promise<void> => kv.delete(name)));
  return keyNames;
};

// Recursively delete all keys matching prefix
const deleteKvCacheByPrefixRecursive = async (
  params: DeletePageParams,
): Promise<readonly string[]> => {
  const listResult: KVNamespaceListResult<unknown, string> = await params.kv.list({
    prefix: params.prefix,
    cursor: params.cursor,
  });

  const deletedFromPage: readonly string[] = await deleteKeysFromPage(params.kv, listResult.keys);
  const newAccumulator: readonly string[] = [...params.accumulator, ...deletedFromPage];

  if (listResult.list_complete) {
    return newAccumulator;
  }

  return deleteKvCacheByPrefixRecursive({
    kv: params.kv,
    prefix: params.prefix,
    cursor: listResult.cursor,
    accumulator: newAccumulator,
  });
};

export const deleteKvCacheByPrefix = async (
  kv: KVNamespace | undefined,
  prefix: string,
): Promise<PrefixDeleteResult> => {
  if (!kv) {
    return { deletedCount: 0, deletedKeys: [] };
  }

  const deletedKeys: readonly string[] = await deleteKvCacheByPrefixRecursive({
    kv,
    prefix,
    cursor: undefined,
    accumulator: [],
  });

  return { deletedCount: deletedKeys.length, deletedKeys };
};
