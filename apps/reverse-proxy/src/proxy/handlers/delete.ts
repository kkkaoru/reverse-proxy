// Proxy DELETE request handler
// Execute with bun: wrangler dev

import {
  createCacheKey,
  deleteKvCacheByPrefix,
  logEvent,
  type PrefixDeleteResult,
} from '../cache.ts';
import {
  KV_CACHE_KEY_PREFIX,
  LOG_EVENT_DELETE,
  LOG_EVENT_INVALID_URL,
  STATUS_BAD_REQUEST,
  STATUS_NOT_FOUND,
  STATUS_OK,
} from '../constants.ts';
import { createErrorResponse, createJsonResponse } from '../responses.ts';
import type { ParsedUrl, ProxyCacheOptions } from '../types.ts';
import { parseTargetUrl } from '../url.ts';

// Handle DELETE request - delete all cache entries matching prefix
export const handleDeleteRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed: ParsedUrl = parseTargetUrl(target);

  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }

  // Delete from Cache API (exact match for today's cache key) - only if enabled
  const cacheKey: string = createCacheKey(parsed.value, new Date());
  const cacheDeleted: boolean = options.enableCacheApi
    ? await caches.default.delete(cacheKey)
    : false;

  // Delete from KV using prefix match
  const kvPrefix: string = `${KV_CACHE_KEY_PREFIX}-${options.cacheVersion}::${parsed.value.toString()}`;
  const kvResult: PrefixDeleteResult = await deleteKvCacheByPrefix(options.kv, kvPrefix);

  const deleted: boolean = cacheDeleted || kvResult.deletedCount > 0;
  const status: number = deleted ? STATUS_OK : STATUS_NOT_FOUND;

  logEvent(options, LOG_EVENT_DELETE, {
    target,
    deleted,
    cacheDeleted,
    kvDeletedCount: kvResult.deletedCount,
  });

  return createJsonResponse(
    {
      deleted,
      cacheDeleted,
      kvDeletedCount: kvResult.deletedCount,
      kvDeletedKeys: kvResult.deletedKeys,
    },
    status,
  );
};
