// IP Rotation type definitions
// Execute with bun: wrangler dev

// All interfaces at top
interface IpRotateEndpoints {
  readonly [domain: string]: readonly string[];
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
}

interface RewriteFailure {
  readonly success: false;
}

type RewriteUrlResult = RewriteResult | RewriteFailure;

interface GetEndpointParams {
  readonly config: IpRotateConfig;
  readonly domain: string;
  readonly counters: Map<string, number>;
}

interface FetchWithAuthParams {
  readonly url: URL;
  readonly auth: IpRotateAuth;
  readonly headers: Record<string, string>;
  readonly method: string;
  readonly body?: string;
}

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
  FetchWithAuthParams,
  GetEndpointParams,
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
};
