#!/usr/bin/env bun
// Export API Gateway endpoints to JSON for reverse-proxy configuration
// Execute with bun: bun scripts/export-endpoints.ts

// Interfaces at top
interface StackOutput {
  readonly OutputKey: string;
  readonly OutputValue: string;
}

interface StackDescription {
  readonly StackName: string;
  readonly Outputs?: readonly StackOutput[];
}

interface DescribeStacksResponse {
  readonly Stacks?: readonly StackDescription[];
}

interface EndpointWithApiKey {
  readonly endpoint: string;
  readonly apiKey: string;
}

interface EndpointsMap {
  readonly [domain: string]: readonly EndpointWithApiKey[];
}

interface ParsedStackName {
  readonly valid: true;
  readonly domain: string;
  readonly region: string;
}

interface InvalidStackName {
  readonly valid: false;
  readonly domain: string;
  readonly region: string;
}

type StackNameResult = ParsedStackName | InvalidStackName;

interface StackEndpoint {
  readonly domain: string;
  readonly endpoint: string;
  readonly apiKeyId: string;
  readonly region: string;
}

interface AccumulatorState {
  readonly acc: Record<string, EndpointWithApiKey[]>;
  readonly item: EndpointWithApiKey & { domain: string };
}

interface FetchEndpointsParams {
  readonly runCommand: (command: string) => Promise<string>;
}

interface ApiKeyResponse {
  readonly value: string;
}

// Constants at top
const STACK_NAME_PREFIX = 'IpRotate-';
const STACK_NAME_SEPARATOR = '-';
const OUTPUT_KEY_API_ENDPOINT = 'ApiEndpoint';
const OUTPUT_KEY_API_KEY_ID = 'ApiKeyId';
const AWS_CLI_DESCRIBE_STACKS_BASE = 'aws cloudformation describe-stacks';
const DEFAULT_REGIONS: readonly string[] = [
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-east-1',
  'ap-southeast-1',
];
const AWS_CLI_GET_API_KEY = 'aws apigateway get-api-key --include-value --api-key';
const MIN_STACK_NAME_PARTS = 4;
const REGION_PARTS_COUNT = 3;
const DOMAIN_SEPARATOR = '.';
const EMPTY_DOMAIN = '';
const EMPTY_REGION = '';
const JSON_INDENT = 2;
const INVALID_RESULT: InvalidStackName = {
  valid: false,
  domain: EMPTY_DOMAIN,
  region: EMPTY_REGION,
};

// Pure functions
const runAwsCli = async (command: string): Promise<string> => {
  const proc = Bun.spawn(['sh', '-c', command], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const output: string = await new Response(proc.stdout).text();
  await proc.exited;
  return output;
};

const parseDescribeStacksOutput = (output: string): DescribeStacksResponse => JSON.parse(output);

const findOutputValue = (outputs: readonly StackOutput[], key: string): string | undefined =>
  outputs.find((output: StackOutput): boolean => output.OutputKey === key)?.OutputValue;

const buildValidStackName = (stackName: string): StackNameResult => {
  const withoutPrefix: string = stackName.slice(STACK_NAME_PREFIX.length);
  const parts: readonly string[] = withoutPrefix.split(STACK_NAME_SEPARATOR);
  if (parts.length < MIN_STACK_NAME_PARTS) return INVALID_RESULT;
  const domainParts: readonly string[] = parts.slice(0, -REGION_PARTS_COUNT);
  const regionParts: readonly string[] = parts.slice(-REGION_PARTS_COUNT);
  const domain: string = domainParts.join(DOMAIN_SEPARATOR);
  const region: string = regionParts.join(STACK_NAME_SEPARATOR);
  return { valid: true, domain, region };
};

const parseStackName = (stackName: string): StackNameResult =>
  stackName.startsWith(STACK_NAME_PREFIX) ? buildValidStackName(stackName) : INVALID_RESULT;

const extractStackEndpoint = (stack: StackDescription): StackEndpoint | null => {
  const parsed: StackNameResult = parseStackName(stack.StackName);
  if (!parsed.valid) return null;

  const outputs: readonly StackOutput[] = stack.Outputs ?? [];
  const endpoint: string | undefined = findOutputValue(outputs, OUTPUT_KEY_API_ENDPOINT);
  const apiKeyId: string | undefined = findOutputValue(outputs, OUTPUT_KEY_API_KEY_ID);
  if (!(endpoint && apiKeyId)) return null;
  return { domain: parsed.domain, endpoint, apiKeyId, region: parsed.region };
};

const addEndpointToAccumulator = (
  state: AccumulatorState,
): Record<string, EndpointWithApiKey[]> => {
  const { domain, endpoint, apiKey } = state.item;
  const entry: EndpointWithApiKey = { endpoint, apiKey };
  if (state.acc[domain]) {
    state.acc[domain]?.push(entry);
  } else {
    state.acc[domain] = [entry];
  }
  return state.acc;
};

const groupEndpointsByDomain = (
  endpoints: readonly (EndpointWithApiKey & { domain: string })[],
): EndpointsMap =>
  endpoints.reduce<Record<string, EndpointWithApiKey[]>>(
    (
      acc: Record<string, EndpointWithApiKey[]>,
      item: EndpointWithApiKey & { domain: string },
    ): Record<string, EndpointWithApiKey[]> => addEndpointToAccumulator({ acc, item }),
    {},
  );

const fetchApiKeyValue = async (
  runCommand: (command: string) => Promise<string>,
  apiKeyId: string,
  region: string,
): Promise<string> => {
  const command = `${AWS_CLI_GET_API_KEY} ${apiKeyId} --region ${region}`;
  const output: string = await runCommand(command);
  const response: ApiKeyResponse = JSON.parse(output);
  return response.value;
};

const collectEndpointsWithApiKeys = async (
  stacks: readonly StackDescription[],
  runCommand: (command: string) => Promise<string>,
): Promise<EndpointsMap> => {
  const stackEndpoints: readonly StackEndpoint[] = stacks
    .map(extractStackEndpoint)
    .filter((item: StackEndpoint | null): item is StackEndpoint => item !== null);

  const endpointsWithApiKeys: (EndpointWithApiKey & { domain: string })[] = await Promise.all(
    stackEndpoints.map(async (item: StackEndpoint) => {
      const apiKey: string = await fetchApiKeyValue(runCommand, item.apiKeyId, item.region);
      return { domain: item.domain, endpoint: item.endpoint, apiKey };
    }),
  );

  return groupEndpointsByDomain(endpointsWithApiKeys);
};

const formatEndpointsJson = (endpoints: EndpointsMap): string =>
  JSON.stringify(endpoints, null, JSON_INDENT);

const fetchStacksFromRegion = async (
  runCommand: (command: string) => Promise<string>,
  region: string,
): Promise<readonly StackDescription[]> => {
  const command = `${AWS_CLI_DESCRIBE_STACKS_BASE} --region ${region}`;
  const output: string = await runCommand(command);
  const response: DescribeStacksResponse = parseDescribeStacksOutput(output);
  return response.Stacks ?? [];
};

const fetchStacksFromAllRegions = async (
  runCommand: (command: string) => Promise<string>,
  regions: readonly string[],
): Promise<readonly StackDescription[]> => {
  const stacksPerRegion: readonly (readonly StackDescription[])[] = await Promise.all(
    regions.map((region: string) => fetchStacksFromRegion(runCommand, region)),
  );
  return stacksPerRegion.flat();
};

const fetchAndCollectEndpoints = async (params: FetchEndpointsParams): Promise<EndpointsMap> => {
  const stacks: readonly StackDescription[] = await fetchStacksFromAllRegions(
    params.runCommand,
    DEFAULT_REGIONS,
  );
  return collectEndpointsWithApiKeys(stacks, params.runCommand);
};

const main = async (): Promise<void> => {
  const endpoints: EndpointsMap = await fetchAndCollectEndpoints({ runCommand: runAwsCli });
  // biome-ignore lint/suspicious/noConsole: CLI output for script result
  console.log(formatEndpointsJson(endpoints));
};

// Export for testing
export {
  addEndpointToAccumulator,
  buildValidStackName,
  collectEndpointsWithApiKeys,
  extractStackEndpoint,
  fetchAndCollectEndpoints,
  fetchApiKeyValue,
  findOutputValue,
  formatEndpointsJson,
  groupEndpointsByDomain,
  parseDescribeStacksOutput,
  parseStackName,
};
export type {
  AccumulatorState,
  ApiKeyResponse,
  DescribeStacksResponse,
  EndpointWithApiKey,
  EndpointsMap,
  FetchEndpointsParams,
  StackDescription,
  StackEndpoint,
  StackNameResult,
  StackOutput,
};

// Main execution - only run when not in test environment
// biome-ignore lint/complexity/useLiteralKeys: process.env access
if (process.env['NODE_ENV'] !== 'test') {
  await main();
}
