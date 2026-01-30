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
  readonly adjustmentMs: number;
}

interface FetchWithAuthParams {
  readonly url: URL;
  readonly auth: IpRotateAuth;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly body?: string;
  readonly signal?: AbortSignal;
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
}

interface FetchWithRetryResult {
  readonly success: true;
  readonly response: Response;
  readonly usedEndpoint: string;
}

interface FetchWithRetryFailure {
  readonly success: false;
  readonly lastResponse: Response | null;
  readonly error: string;
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

export type {
  EndpointWithApiKey,
  FetchRetryResult,
  FetchWithAuthParams,
  FetchWithRetryFailure,
  FetchWithRetryParams,
  FetchWithRetryResult,
  GetEndpointParams,
  GetNextEndpointResult,
  IpRotateAuth,
  IpRotateAuthApiKey,
  IpRotateAuthIam,
  IpRotateConfig,
  IpRotateEndpoints,
  ParseConfigParams,
  ParsedConfig,
  RewriteFailure,
  RewriteResult,
  RewriteUrlResult,
  TimeoutConfig,
};
