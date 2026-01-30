// Proxy cache type definitions
// Execute with bun: wrangler dev

import type { IpRotateConfig } from '../ip-rotate/types.ts';

// Public interfaces
export interface ProxyCacheStaticOptions {
  enableLogging: boolean;
}

export interface ProxyCacheEnv {
  KV?: KVNamespace;
  CACHE_VERSION?: string;
  IP_ROTATE_ENDPOINTS?: string;
  IP_ROTATE_AUTH_TYPE?: string;
  IP_ROTATE_API_KEY?: string;
  IP_ROTATE_AWS_ACCESS_KEY_ID?: string;
  IP_ROTATE_AWS_SECRET_ACCESS_KEY?: string;
  IP_ROTATE_AWS_REGION?: string;
}

// Internal interfaces
export interface ProxyCacheOptions {
  enableLogging: boolean;
  kv?: KVNamespace;
  cacheVersion: string;
  ipRotateConfig?: IpRotateConfig;
  ipRotateCounters: Map<string, number>;
}

export interface CachedContent {
  content: string;
  contentType: string;
}

export interface SetKvCacheParams {
  kv: KVNamespace;
  cacheKey: string;
  data: CachedContent;
}

export interface ParsedUrlSuccess {
  success: true;
  value: URL;
}

export interface ParsedUrlFailure {
  success: false;
  message: string;
}

export interface FetchAndCacheParams {
  cacheKey: string;
  kvCacheKey: string;
  target: URL;
  options: ProxyCacheOptions;
}

export interface LogEventDetail {
  target?: string;
  finalUrl?: string;
  status?: number;
  body?: string;
  error?: string;
  deleted?: boolean;
  cacheDeleted?: boolean;
  kvDeleted?: boolean;
  method?: string;
  cacheKey?: string;
  ipRotateUrl?: string;
}

export interface IpRotateFetchParams {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly config: IpRotateConfig;
  readonly counters: Map<string, number>;
}

export interface LogUpstreamErrorParams {
  options: ProxyCacheOptions;
  target: URL;
  currentUrl: string;
  response: Response;
}

export interface ProcessFetchResponseParams {
  params: FetchAndCacheParams;
  response: Response;
  currentUrl: string;
}

// Types
export type ParsedUrl = ParsedUrlSuccess | ParsedUrlFailure;
export type RequestHandler = (target: string) => Promise<Response>;
