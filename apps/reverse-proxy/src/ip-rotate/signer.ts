// IP Rotation IAM signer using @smithy/signature-v4
// Execute with bun: wrangler dev
// SECURITY: IAM signature headers are consumed by API Gateway, not forwarded to target

import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';
import type { IpRotateAuthIam } from './types.ts';

// Interfaces at top
interface SignRequestParams {
  readonly url: URL;
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
  readonly auth: IpRotateAuthIam;
}

interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

interface SignerConfig {
  readonly credentials: AwsCredentials;
  readonly region: string;
  readonly service: string;
  readonly sha256: typeof Sha256;
}

interface HttpRequest {
  readonly method: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly port?: number;
  readonly path: string;
  readonly query?: Record<string, string>;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

// Constants at top
const SERVICE_EXECUTE_API = 'execute-api';
const HEADER_HOST = 'host';

// Pure functions
const createCredentials = (auth: IpRotateAuthIam): AwsCredentials => ({
  accessKeyId: auth.accessKeyId,
  secretAccessKey: auth.secretAccessKey,
});

const createSignerConfig = (auth: IpRotateAuthIam): SignerConfig => ({
  credentials: createCredentials(auth),
  region: auth.region,
  service: SERVICE_EXECUTE_API,
  sha256: Sha256,
});

const createSigner = (auth: IpRotateAuthIam): SignatureV4 =>
  new SignatureV4(createSignerConfig(auth));

const buildRequestPath = (url: URL): string => `${url.pathname}${url.search}`;

const buildRequestHeaders = (
  headers: Record<string, string>,
  hostname: string,
): Record<string, string> => ({
  ...headers,
  [HEADER_HOST]: hostname,
});

const DEFAULT_PROTOCOL = 'https:';

const createHttpRequest = (params: SignRequestParams): HttpRequest => ({
  method: params.method,
  protocol: params.url.protocol || DEFAULT_PROTOCOL,
  hostname: params.url.hostname,
  path: buildRequestPath(params.url),
  headers: buildRequestHeaders(params.headers, params.url.hostname),
  body: params.body,
});

const extractSignedHeaders = (signed: {
  headers: Record<string, string>;
}): Record<string, string> => signed.headers;

const signRequest = async (params: SignRequestParams): Promise<SignedRequest> => {
  const signer: SignatureV4 = createSigner(params.auth);
  const httpRequest: HttpRequest = createHttpRequest(params);
  const signed = await signer.sign(httpRequest);

  return {
    url: params.url.toString(),
    headers: extractSignedHeaders(signed),
  };
};

export { signRequest };
export type { SignRequestParams, SignedRequest };
