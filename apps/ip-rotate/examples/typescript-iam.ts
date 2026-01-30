#!/usr/bin/env bun

// Example: Request with IAM authentication using TypeScript
// Execute with: bun examples/typescript-iam.ts
// Requires: bun add @smithy/signature-v4 @aws-crypto/sha256-js

import { Sha256 } from '@aws-crypto/sha256-js';
import { SignatureV4 } from '@smithy/signature-v4';

// Interfaces at top
interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

interface RequestConfig {
  readonly endpoint: string;
  readonly region: string;
  readonly credentials: AwsCredentials;
  readonly path: string;
}

interface SignedRequestParams {
  readonly method: string;
  readonly url: URL;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

interface SignerInput {
  readonly method: string;
  readonly protocol: string;
  readonly hostname: string;
  readonly path: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

// Constants at top
const SERVICE_EXECUTE_API = 'execute-api';
const HEADER_HOST = 'host';
const HEADER_CONTENT_TYPE = 'Content-Type';
const CONTENT_TYPE_JSON = 'application/json';
const HTTP_METHOD_GET = 'GET';
const HTTP_METHOD_POST = 'POST';
const DEFAULT_ENDPOINT = 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy';
const DEFAULT_PATH = '/ip';

// Pure functions
const createSigner = (credentials: AwsCredentials, region: string): SignatureV4 =>
  new SignatureV4({
    credentials,
    region,
    service: SERVICE_EXECUTE_API,
    sha256: Sha256,
  });

const buildUrl = (endpoint: string, path: string): URL => new URL(`${endpoint}${path}`);

const createSignerInput = (params: SignedRequestParams): SignerInput => ({
  method: params.method,
  protocol: params.url.protocol,
  hostname: params.url.hostname,
  path: params.url.pathname + params.url.search,
  headers: { ...params.headers, [HEADER_HOST]: params.url.hostname },
  body: params.body,
});

const signAndFetch = async (
  config: RequestConfig,
  params: SignedRequestParams,
): Promise<Response> => {
  const signer: SignatureV4 = createSigner(config.credentials, config.region);
  const signerInput: SignerInput = createSignerInput(params);
  const signed = await signer.sign(signerInput);

  return globalThis.fetch(params.url.toString(), {
    method: params.method,
    headers: signed.headers,
    body: params.body,
  });
};

const fetchWithIam = (config: RequestConfig, method: string, body?: string): Promise<Response> => {
  const url: URL = buildUrl(config.endpoint, config.path);
  const headers: Record<string, string> = body ? { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON } : {};

  return signAndFetch(config, { method, url, headers, body });
};

// Example usage
const main = async (): Promise<void> => {
  const config: RequestConfig = {
    endpoint: process.env.EXAMPLE_ENDPOINT ?? DEFAULT_ENDPOINT,
    region: process.env.AWS_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.AWS_ACCESS_KEY_ID ?? '',
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY ?? '',
    },
    path: process.env.EXAMPLE_PATH ?? DEFAULT_PATH,
  };

  // Validate credentials
  if (!(config.credentials.accessKeyId && config.credentials.secretAccessKey)) {
    // biome-ignore lint/suspicious/noConsole: error output
    console.error('Error: AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY must be set');
    process.exit(1);
  }

  // GET request
  const getResponse: Response = await fetchWithIam(config, HTTP_METHOD_GET);
  const getData: unknown = await getResponse.json();
  // biome-ignore lint/suspicious/noConsole: example output
  console.log('GET response:', getData);

  // POST request with JSON body
  const postResponse: Response = await fetchWithIam(
    config,
    HTTP_METHOD_POST,
    JSON.stringify({ key: 'value' }),
  );
  const postData: unknown = await postResponse.json();
  // biome-ignore lint/suspicious/noConsole: example output
  console.log('POST response:', postData);
};

if (process.env.NODE_ENV !== 'test') {
  await main();
}

export { createSigner, buildUrl, createSignerInput, signAndFetch, fetchWithIam };
export type { AwsCredentials, RequestConfig, SignedRequestParams, SignerInput };
