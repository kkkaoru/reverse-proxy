#!/usr/bin/env bun
// Example: Request with x-api-key authentication using TypeScript
// Execute with: bun examples/typescript-api-key.ts

// Interfaces at top
interface RequestConfig {
  readonly endpoint: string;
  readonly apiKey: string;
  readonly path: string;
}

interface FetchOptions {
  readonly method: string;
  readonly headers: Record<string, string>;
  readonly body?: string;
}

// Constants at top
const HEADER_API_KEY = 'x-api-key';
const HEADER_CONTENT_TYPE = 'Content-Type';
const CONTENT_TYPE_JSON = 'application/json';
const HTTP_METHOD_GET = 'GET';
const HTTP_METHOD_POST = 'POST';
const DEFAULT_ENDPOINT = 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy';
const DEFAULT_PATH = '/ip';

// Pure functions
const createHeaders = (apiKey: string): Record<string, string> => ({
  [HEADER_API_KEY]: apiKey,
});

const createJsonHeaders = (apiKey: string): Record<string, string> => ({
  [HEADER_API_KEY]: apiKey,
  [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON,
});

const buildUrl = (endpoint: string, path: string): string => `${endpoint}${path}`;

const fetchWithApiKey = (config: RequestConfig, options: FetchOptions): Promise<Response> => {
  const url: string = buildUrl(config.endpoint, config.path);
  const headers: Record<string, string> = options.body
    ? createJsonHeaders(config.apiKey)
    : createHeaders(config.apiKey);

  return globalThis.fetch(url, {
    method: options.method,
    headers,
    body: options.body,
  });
};

// Example usage
const main = async (): Promise<void> => {
  const config: RequestConfig = {
    endpoint: process.env.EXAMPLE_ENDPOINT ?? DEFAULT_ENDPOINT,
    apiKey: process.env.IP_ROTATE_API_KEY ?? 'your-api-key-here',
    path: process.env.EXAMPLE_PATH ?? DEFAULT_PATH,
  };

  // GET request
  const getResponse: Response = await fetchWithApiKey(config, {
    method: HTTP_METHOD_GET,
    headers: createHeaders(config.apiKey),
  });
  const getData: unknown = await getResponse.json();
  // biome-ignore lint/suspicious/noConsole: example output
  console.log('GET response:', getData);

  // POST request with JSON body
  const postResponse: Response = await fetchWithApiKey(config, {
    method: HTTP_METHOD_POST,
    headers: createJsonHeaders(config.apiKey),
    body: JSON.stringify({ key: 'value' }),
  });
  const postData: unknown = await postResponse.json();
  // biome-ignore lint/suspicious/noConsole: example output
  console.log('POST response:', postData);
};

if (process.env.NODE_ENV !== 'test') {
  await main();
}

export { createHeaders, createJsonHeaders, buildUrl, fetchWithApiKey };
export type { RequestConfig, FetchOptions };
