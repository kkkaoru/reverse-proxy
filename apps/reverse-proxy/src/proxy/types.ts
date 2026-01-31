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
  ENABLE_CACHE_API?: string;
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
  enableCacheApi: boolean;
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
  kvDeletedCount?: number;
  method?: string;
  cacheKey?: string;
  ipRotateUrl?: string;
  ipRotateEndpoint?: string;
}

export interface IpRotateFetchParams {
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly config: IpRotateConfig;
  readonly counters: Map<string, number>;
}

export interface IpRotateFetchResult {
  readonly response: Response;
  readonly usedEndpoint: string;
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

// SSRF validation types
export interface SsrfValidationSuccess {
  readonly valid: true;
  readonly url: URL;
}

export interface SsrfValidationFailure {
  readonly valid: false;
  readonly reason: string;
}

export type SsrfValidationResult = SsrfValidationSuccess | SsrfValidationFailure;

// Batch fetch types
export type BatchResultStatus = 'success' | 'error' | 'ssrf_blocked' | 'timeout' | 'skipped';

export interface BatchFetchResult {
  readonly url: string;
  readonly httpStatus: number;
  readonly result: BatchResultStatus;
  readonly body: string;
}

export interface BatchRequestBody {
  readonly urls: readonly string[];
}

export interface SingleFetchParams {
  readonly url: string;
  readonly options: ProxyCacheOptions;
}

export interface BatchFetchParams {
  readonly urls: readonly string[];
  readonly options: ProxyCacheOptions;
}

export interface FetchTask {
  readonly url: string;
  readonly index: number;
  readonly isRetry: boolean;
}

export interface ResourceUsage {
  readonly memoryBytes: number;
  readonly subrequestCount: number;
}

export interface ResourceLimits {
  readonly maxMemoryBytes: number;
  readonly maxSubrequests: number;
}

export type SettledResult = PromiseSettledResult<BatchFetchResult>;
export type FulfilledResult = PromiseFulfilledResult<BatchFetchResult>;

export interface ProcessBatchParams {
  readonly tasks: readonly FetchTask[];
  readonly options: ProxyCacheOptions;
}

export interface ProcessSettledResultParams {
  readonly settled: SettledResult;
  readonly task: FetchTask;
  readonly results: (BatchFetchResult | null)[];
  readonly retried: Set<number>;
  readonly retryQueue: FetchTask[];
}

export interface ExecuteBatchContextParams {
  readonly results: (BatchFetchResult | null)[];
  readonly retried: Set<number>;
  readonly options: ProxyCacheOptions;
}

export interface BatchExecutionState {
  readonly limits: ResourceLimits;
  readonly results: (BatchFetchResult | null)[];
  readonly retried: Set<number>;
  readonly queue: FetchTask[];
  readonly options: ProxyCacheOptions;
}

export interface LoopIterationParams {
  readonly state: BatchExecutionState;
  readonly urlCount: number;
}

export interface ExecuteSingleBatchParams {
  readonly state: BatchExecutionState;
}

export type BatchRequestHandler = (body: unknown) => Promise<Response>;
