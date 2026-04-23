// IP Rotation type definitions
// Execute with bun: wrangler dev

// All interfaces at top
interface EndpointWithApiKey {
  readonly endpoint: string;
  readonly apiKey: string;
}

interface IpRotateEndpoints {
  readonly [domain: string]: readonly EndpointWithApiKey[];
}

interface IpRotateAuthApiKey {
  readonly type: 'api-key';
  readonly apiKey: string;
}

interface IpRotateAuthIam {
  readonly type: 'iam';
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

type IpRotateAuth = IpRotateAuthApiKey | IpRotateAuthIam;

interface IpRotateConfig {
  readonly endpoints: IpRotateEndpoints;
  readonly auth: IpRotateAuth;
}

interface RewriteResult {
  readonly success: true;
  readonly url: URL;
  readonly apiKey: string;
}

interface RewriteFailure {
  readonly success: false;
}

type RewriteUrlResult = RewriteResult | RewriteFailure;

interface GetNextEndpointResult {
  readonly endpoint: string;
  readonly apiKey: string;
}

interface GetEndpointParams {
  readonly config: IpRotateConfig;
  readonly domain: string;
  readonly counters: Map<string, number>;
}

interface TimeoutConfig {
  readonly defaultMs: number;
  readonly minMs: number;
  readonly maxMs: number;
}

interface FetchWithAuthParams {
  readonly url: URL;
  readonly auth: IpRotateAuth;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly body?: string;
  readonly signal?: AbortSignal;
}

// Per-endpoint outcome emitted during retry loop so the caller can persist
// failure/throttle signals to the global Durable Object coordinator in real
// time (not just the final attempt).
interface EndpointOutcome {
  readonly index: number;
  readonly endpoint: string;
  readonly status: number | undefined;
  readonly isSuccess: boolean;
  readonly isThrottle: boolean;
  readonly isServerError: boolean;
}

interface FetchWithRetryParams {
  readonly config: IpRotateConfig;
  readonly targetUrl: URL;
  readonly counters: Map<string, number>;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly body?: string;
  readonly timeoutMs?: number;
  readonly envDefaultTimeoutMs?: string;
  readonly wallClockSignal?: AbortSignal;
  readonly envHealthTtlMs?: string;
  readonly envEwmaHalfLifeMs?: string;
  readonly envMaxHedgeAttempts?: string;
  readonly envHedgeDelayMs?: string;
  readonly envThrottleBaseDelayMs?: string;
  readonly envThrottleTtlMs?: string;
  readonly envHedgeSuppressThreshold?: string;
  readonly onEndpointOutcome?: (outcome: EndpointOutcome) => void;
}

interface FetchWithRetryResult {
  readonly success: true;
  readonly response: Response;
  readonly usedEndpoint: string;
}

type FetchRetryErrorCode = 'MAX_RETRIES' | 'WALL_CLOCK_TIMEOUT' | 'NO_ENDPOINTS';

interface FetchWithRetryFailure {
  readonly success: false;
  readonly lastResponse: Response | null;
  readonly lastUsedEndpoint: string | null;
  readonly error: string;
  readonly errorCode: FetchRetryErrorCode;
  readonly totalAttempts: number;
}

type FetchRetryResult = FetchWithRetryResult | FetchWithRetryFailure;

interface ParseConfigParams {
  readonly endpointsJson: string | undefined;
  readonly authType: string | undefined;
  readonly apiKey: string | undefined;
  readonly accessKeyId: string | undefined;
  readonly secretAccessKey: string | undefined;
  readonly region: string | undefined;
}

interface ParseConfigResult {
  readonly success: true;
  readonly config: IpRotateConfig;
}

interface ParseConfigFailure {
  readonly success: false;
  readonly error: string;
}

type ParsedConfig = ParseConfigResult | ParseConfigFailure;

interface IndexedEndpoint {
  readonly endpoint: EndpointWithApiKey;
  readonly index: number;
}

interface RegionAwareEndpointResult {
  readonly endpoint: EndpointWithApiKey;
  readonly region: string;
  readonly index: number;
}

interface SelectRegionAwareEndpointParams {
  readonly endpoints: readonly EndpointWithApiKey[];
  readonly triedRegions: ReadonlySet<string>;
  readonly triedEndpointIndices: ReadonlySet<number>;
  readonly endpointWeights?: readonly number[];
}

export type {
  EndpointOutcome,
  EndpointWithApiKey,
  FetchRetryErrorCode,
  FetchRetryResult,
  FetchWithAuthParams,
  FetchWithRetryFailure,
  FetchWithRetryParams,
  FetchWithRetryResult,
  GetEndpointParams,
  GetNextEndpointResult,
  IndexedEndpoint,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
  IpRotateConfig,
  IpRotateEndpoints,
  ParseConfigParams,
  ParsedConfig,
  RegionAwareEndpointResult,
  RewriteFailure,
  RewriteResult,
  RewriteUrlResult,
  SelectRegionAwareEndpointParams,
  TimeoutConfig,
};
