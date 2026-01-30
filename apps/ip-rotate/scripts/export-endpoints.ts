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

interface EndpointsMap {
  readonly [domain: string]: readonly string[];
}

interface ParsedStackName {
  readonly valid: true;
  readonly domain: string;
}

interface InvalidStackName {
  readonly valid: false;
  readonly domain: string;
}

type StackNameResult = ParsedStackName | InvalidStackName;

interface StackEndpoint {
  readonly domain: string;
  readonly endpoint: string;
}

interface AccumulatorState {
  readonly acc: Record<string, string[]>;
  readonly item: StackEndpoint;
}

interface FetchEndpointsParams {
  readonly runCommand: (command: string) => Promise<string>;
}

// Constants at top
const STACK_NAME_PREFIX = 'IpRotate-';
const STACK_NAME_SEPARATOR = '-';
const OUTPUT_KEY_API_ENDPOINT = 'ApiEndpoint';
const AWS_CLI_DESCRIBE_STACKS = 'aws cloudformation describe-stacks';
const MIN_STACK_NAME_PARTS = 4;
const REGION_PARTS_COUNT = 3;
const DOMAIN_SEPARATOR = '.';
const EMPTY_DOMAIN = '';
const JSON_INDENT = 2;
const INVALID_RESULT: InvalidStackName = { valid: false, domain: EMPTY_DOMAIN };

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
  const domainParts: readonly string[] = parts.slice(0, -REGION_PARTS_COUNT);
  const domain: string = domainParts.join(DOMAIN_SEPARATOR);
  return parts.length < MIN_STACK_NAME_PARTS ? INVALID_RESULT : { valid: true, domain };
};

const parseStackName = (stackName: string): StackNameResult =>
  stackName.startsWith(STACK_NAME_PREFIX) ? buildValidStackName(stackName) : INVALID_RESULT;

const extractStackEndpoint = (stack: StackDescription): StackEndpoint | null => {
  const parsed: StackNameResult = parseStackName(stack.StackName);
  if (!parsed.valid) return null;

  const outputs: readonly StackOutput[] = stack.Outputs ?? [];
  const endpoint: string | undefined = findOutputValue(outputs, OUTPUT_KEY_API_ENDPOINT);
  return endpoint ? { domain: parsed.domain, endpoint } : null;
};

const addEndpointToAccumulator = (state: AccumulatorState): Record<string, string[]> =>
  state.acc[state.item.domain]
    ? (() => {
        state.acc[state.item.domain]?.push(state.item.endpoint);
        return state.acc;
      })()
    : (() => {
        state.acc[state.item.domain] = [state.item.endpoint];
        return state.acc;
      })();

const groupEndpointsByDomain = (endpoints: readonly StackEndpoint[]): EndpointsMap =>
  endpoints.reduce<Record<string, string[]>>(
    (acc: Record<string, string[]>, item: StackEndpoint): Record<string, string[]> =>
      addEndpointToAccumulator({ acc, item }),
    {},
  );

const collectEndpoints = (stacks: readonly StackDescription[]): EndpointsMap =>
  groupEndpointsByDomain(
    stacks
      .map(extractStackEndpoint)
      .filter((item: StackEndpoint | null): item is StackEndpoint => item !== null),
  );

const formatEndpointsJson = (endpoints: EndpointsMap): string =>
  JSON.stringify(endpoints, null, JSON_INDENT);

const fetchAndCollectEndpoints = async (params: FetchEndpointsParams): Promise<EndpointsMap> => {
  const output: string = await params.runCommand(AWS_CLI_DESCRIBE_STACKS);
  const response: DescribeStacksResponse = parseDescribeStacksOutput(output);
  const stacks: readonly StackDescription[] = response.Stacks ?? [];
  return collectEndpoints(stacks);
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
  collectEndpoints,
  extractStackEndpoint,
  fetchAndCollectEndpoints,
  findOutputValue,
  formatEndpointsJson,
  groupEndpointsByDomain,
  parseDescribeStacksOutput,
  parseStackName,
};
export type {
  AccumulatorState,
  DescribeStacksResponse,
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
