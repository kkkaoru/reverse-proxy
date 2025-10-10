import type { Context, MiddlewareHandler, Next } from 'hono';
import { createMiddleware } from 'hono/factory';

type ParsedUrl =
  | {
      success: true;
      value: URL;
    }
  | {
      success: false;
      message: string;
    };

const ROOT_PATH = '/';
const QUERY_KEY_TARGET = 'url';
const METHOD_GET = 'GET';
const METHOD_DELETE = 'DELETE';
const CACHE_MODE_NO_STORE = 'no-store';
const HEADER_CONTENT_TYPE = 'content-type';
const CONTENT_TYPE_JSON = 'application/json; charset=utf-8';
const STATUS_OK = 200;
const STATUS_BAD_REQUEST = 400;
const STATUS_NOT_FOUND = 404;
const STATUS_ACCEPTED = 202;
const ERROR_MISSING_URL = 'Query parameter "url" is required.';
const ERROR_INVALID_URL = 'Query parameter "url" must be a valid absolute URL.';
const LOG_PREFIX = '[reverse-proxy]';
const LOG_EVENT_CACHE_HIT = 'cache-hit';
const LOG_EVENT_CACHE_MISS = 'cache-miss';
const LOG_EVENT_FETCH_STATUS = 'fetch-status';
const LOG_EVENT_DELETE = 'cache-delete';
const LOG_EVENT_INVALID_URL = 'invalid-url';
const LOG_EVENT_MISSING_QUERY = 'missing-url-query';
const LOG_EVENT_QUEUE_ENQUEUE = 'queue-enqueue';
const LOG_EVENT_QUEUE_PROCESS = 'queue-process';
const DEFAULT_QUEUE_DELAY_SECONDS = 1;

export interface ProxyCacheOptions {
  enableLogging: boolean;
  queueBinding?: string;
  queueDelaySeconds?: number;
}

const logEvent = (
  options: ProxyCacheOptions,
  message: string,
  detail: Record<string, unknown>,
): void => {
  if (!options.enableLogging) {
    return;
  }
  // biome-ignore lint/suspicious/noConsole: explicit logging requested for observability.
  console.log(LOG_PREFIX, message, detail);
};

const createJsonResponse = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: {
      [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
    },
  });

const createErrorResponse = (message: string, status: number): Response =>
  createJsonResponse({ error: message }, status);

const parseTargetUrl = (raw: string): ParsedUrl => {
  try {
    return {
      success: true,
      value: new URL(raw),
    };
  } catch {
    return {
      success: false,
      message: ERROR_INVALID_URL,
    };
  }
};

const formatKeyDate = (date: Date = new Date()): string => {
  const [datePart] = date.toISOString().split('T');
  return datePart ?? '';
};

const createCacheKey = (target: URL, date: Date = new Date()): string =>
  `${target.toString()}::${formatKeyDate(date)}`;

const fetchAndCache = async (cacheKey: string, target: URL): Promise<Response> => {
  const upstream = await globalThis.fetch(target.toString(), {
    cache: CACHE_MODE_NO_STORE,
  });
  if (upstream.ok) {
    const upstreamForCache = upstream.clone();
    const sanitizedHeaders = new Headers(upstreamForCache.headers);
    sanitizedHeaders.delete('set-cookie');
    const cacheable = new Response(upstreamForCache.body, {
      headers: sanitizedHeaders,
      status: upstreamForCache.status,
      statusText: upstreamForCache.statusText,
    });
    await caches.default.put(cacheKey, cacheable);
  }
  return upstream;
};

const handleProxyRequest = async (
  target: string,
  options: ProxyCacheOptions,
  queueProducer?: Queue,
): Promise<Response> => {
  const parsed = parseTargetUrl(target);
  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }
  const cacheKey = createCacheKey(parsed.value);
  const cached = await caches.default.match(cacheKey);
  if (cached) {
    logEvent(options, LOG_EVENT_CACHE_HIT, { target });
    return cached.clone();
  }
  logEvent(options, LOG_EVENT_CACHE_MISS, { target });
  if (queueProducer) {
    const delaySeconds = options.queueDelaySeconds ?? DEFAULT_QUEUE_DELAY_SECONDS;
    await queueProducer.send({ target: parsed.value.toString() }, { delaySeconds });
    logEvent(options, LOG_EVENT_QUEUE_ENQUEUE, { target, delaySeconds });
    return createJsonResponse(
      {
        status: 'queued',
        target: parsed.value.toString(),
      },
      STATUS_ACCEPTED,
    );
  }
  const upstreamResponse = await fetchAndCache(cacheKey, parsed.value);
  logEvent(options, LOG_EVENT_FETCH_STATUS, { target, status: upstreamResponse.status });
  return upstreamResponse;
};

const handleDeleteRequest = async (
  target: string,
  options: ProxyCacheOptions,
): Promise<Response> => {
  const parsed = parseTargetUrl(target);
  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target });
    return createErrorResponse(parsed.message, STATUS_BAD_REQUEST);
  }
  const cacheKey = createCacheKey(parsed.value);
  const deleted = await caches.default.delete(cacheKey);
  const status = deleted ? STATUS_OK : STATUS_NOT_FOUND;
  logEvent(options, LOG_EVENT_DELETE, { target, deleted });
  return createJsonResponse({ deleted }, status);
};

export const createProxyCacheMiddleware = (options: ProxyCacheOptions): MiddlewareHandler =>
  createMiddleware(async (c: Context, next: Next) => {
    if (c.req.path !== ROOT_PATH) {
      await next();
      return;
    }
    const queueProducer = options.queueBinding
      ? ((c.env as Record<string, unknown>)[options.queueBinding] as Queue | undefined)
      : undefined;
    const handlers: Record<string, (target: string) => Promise<Response>> = {
      [METHOD_GET]: (target: string) => handleProxyRequest(target, options, queueProducer),
      [METHOD_DELETE]: (target: string) => handleDeleteRequest(target, options),
    };
    const handler = handlers[c.req.method];
    if (!handler) {
      await next();
      return;
    }
    const target = c.req.query(QUERY_KEY_TARGET);
    if (!target) {
      logEvent(options, LOG_EVENT_MISSING_QUERY, { method: c.req.method });
      return createErrorResponse(ERROR_MISSING_URL, STATUS_BAD_REQUEST);
    }
    return handler(target);
  });

export interface CacheWarmMessage {
  target: string;
}

export const processCacheWarmMessage = async (
  message: CacheWarmMessage,
  options: ProxyCacheOptions,
): Promise<void> => {
  if (!message.target) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target: message.target });
    return;
  }
  const parsed = parseTargetUrl(message.target);
  if (!parsed.success) {
    logEvent(options, LOG_EVENT_INVALID_URL, { target: message.target });
    return;
  }
  const cacheKey = createCacheKey(parsed.value);
  const response = await fetchAndCache(cacheKey, parsed.value);
  logEvent(options, LOG_EVENT_QUEUE_PROCESS, {
    target: message.target,
    status: response.status,
  });
};
