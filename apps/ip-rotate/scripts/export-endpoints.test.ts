// Export endpoints tests
// Execute with bun: bun test

import { describe, expect, test } from 'vitest';
import type {
  AccumulatorState,
  DescribeStacksResponse,
  EndpointsMap,
  EndpointWithApiKey,
  FetchEndpointsParams,
  StackDescription,
  StackEndpoint,
  StackNameResult,
  StackOutput,
} from './export-endpoints.ts';
import {
  addEndpointToAccumulator,
  buildValidStackName,
  extractStackEndpoint,
  fetchAndCollectEndpoints,
  findOutputValue,
  formatEndpointsJson,
  groupEndpointsByDomain,
  parseDescribeStacksOutput,
  parseStackName,
} from './export-endpoints.ts';

describe('parseStackName', () => {
  test('should parse valid stack name with single domain part', () => {
    const result: StackNameResult = parseStackName('IpRotate-example-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'example', region: 'us-east-1' });
  });

  test('should parse valid stack name with multiple domain parts', () => {
    const result: StackNameResult = parseStackName('IpRotate-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'api.example.com', region: 'us-east-1' });
  });

  test('should parse valid stack name with different region', () => {
    const result: StackNameResult = parseStackName('IpRotate-data-test-org-eu-west-1');
    expect(result).toStrictEqual({ valid: true, domain: 'data.test.org', region: 'eu-west-1' });
  });

  test('should return invalid for stack name without prefix', () => {
    const result: StackNameResult = parseStackName('OtherStack-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '', region: '' });
  });

  test('should return invalid for stack name with too few parts', () => {
    const result: StackNameResult = parseStackName('IpRotate-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '', region: '' });
  });

  test('should return invalid for empty stack name', () => {
    const result: StackNameResult = parseStackName('');
    expect(result).toStrictEqual({ valid: false, domain: '', region: '' });
  });

  test('should return invalid for stack name with only prefix', () => {
    const result: StackNameResult = parseStackName('IpRotate-');
    expect(result).toStrictEqual({ valid: false, domain: '', region: '' });
  });
});

describe('buildValidStackName', () => {
  test('should build valid result for stack name with enough parts', () => {
    const result: StackNameResult = buildValidStackName('IpRotate-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'api.example.com', region: 'us-east-1' });
  });

  test('should return invalid for stack name with too few parts', () => {
    const result: StackNameResult = buildValidStackName('IpRotate-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '', region: '' });
  });
});

describe('findOutputValue', () => {
  test('should find output value by key', () => {
    const outputs: readonly StackOutput[] = [
      { OutputKey: 'ApiEndpoint', OutputValue: 'https://api.example.com' },
      { OutputKey: 'ApiId', OutputValue: 'abc123' },
    ];
    const result: string | undefined = findOutputValue(outputs, 'ApiEndpoint');
    expect(result).toBe('https://api.example.com');
  });

  test('should return undefined for non-existent key', () => {
    const outputs: readonly StackOutput[] = [
      { OutputKey: 'ApiEndpoint', OutputValue: 'https://api.example.com' },
    ];
    const result: string | undefined = findOutputValue(outputs, 'NonExistent');
    expect(result).toBeUndefined();
  });

  test('should return undefined for empty outputs array', () => {
    const outputs: readonly StackOutput[] = [];
    const result: string | undefined = findOutputValue(outputs, 'ApiEndpoint');
    expect(result).toBeUndefined();
  });

  test('should find first matching output when duplicates exist', () => {
    const outputs: readonly StackOutput[] = [
      { OutputKey: 'ApiEndpoint', OutputValue: 'https://first.example.com' },
      { OutputKey: 'ApiEndpoint', OutputValue: 'https://second.example.com' },
    ];
    const result: string | undefined = findOutputValue(outputs, 'ApiEndpoint');
    expect(result).toBe('https://first.example.com');
  });
});

describe('parseDescribeStacksOutput', () => {
  test('should parse valid JSON response', () => {
    const json: string = '{"Stacks":[{"StackName":"test","Outputs":[]}]}';
    const result: DescribeStacksResponse = parseDescribeStacksOutput(json);
    expect(result).toStrictEqual({ Stacks: [{ StackName: 'test', Outputs: [] }] });
  });

  test('should parse empty stacks response', () => {
    const json: string = '{"Stacks":[]}';
    const result: DescribeStacksResponse = parseDescribeStacksOutput(json);
    expect(result).toStrictEqual({ Stacks: [] });
  });

  test('should parse response without Stacks key', () => {
    const json: string = '{}';
    const result: DescribeStacksResponse = parseDescribeStacksOutput(json);
    expect(result).toStrictEqual({});
  });
});

describe('extractStackEndpoint', () => {
  test('should extract endpoint from valid stack', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
      Outputs: [
        {
          OutputKey: 'ApiEndpoint',
          OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        },
        {
          OutputKey: 'ApiKeyId',
          OutputValue: 'test-api-key-id',
        },
      ],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toStrictEqual({
      domain: 'api.example.com',
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      apiKeyId: 'test-api-key-id',
      region: 'us-east-1',
    });
  });

  test('should return null for stack without IpRotate prefix', () => {
    const stack: StackDescription = {
      StackName: 'OtherStack-api-example-com-us-east-1',
      Outputs: [
        {
          OutputKey: 'ApiEndpoint',
          OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        },
        {
          OutputKey: 'ApiKeyId',
          OutputValue: 'test-api-key-id',
        },
      ],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });

  test('should return null for stack without ApiEndpoint output', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
      Outputs: [{ OutputKey: 'ApiKeyId', OutputValue: 'test-api-key-id' }],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });

  test('should return null for stack without ApiKeyId output', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
      Outputs: [
        {
          OutputKey: 'ApiEndpoint',
          OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        },
      ],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });

  test('should return null for stack with empty outputs', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
      Outputs: [],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });

  test('should return null for stack with undefined outputs', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });
});

describe('addEndpointToAccumulator', () => {
  test('should add endpoint to new domain', () => {
    const state: AccumulatorState = {
      acc: {},
      item: {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-value',
      },
    };
    const result: Record<string, EndpointWithApiKey[]> = addEndpointToAccumulator(state);
    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-value',
        },
      ],
    });
  });

  test('should add endpoint to existing domain', () => {
    const state: AccumulatorState = {
      acc: {
        'api.example.com': [
          {
            endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
            apiKey: 'test-api-key-1',
          },
        ],
      },
      item: {
        domain: 'api.example.com',
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-2',
      },
    };
    const result: Record<string, EndpointWithApiKey[]> = addEndpointToAccumulator(state);
    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-1',
        },
        {
          endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-2',
        },
      ],
    });
  });
});

describe('groupEndpointsByDomain', () => {
  test('should group single endpoint', () => {
    const endpoints: (EndpointWithApiKey & { domain: string })[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'test-api-key',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key',
        },
      ],
    });
  });

  test('should group multiple endpoints for same domain', () => {
    const endpoints: (EndpointWithApiKey & { domain: string })[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-1',
      },
      {
        domain: 'api.example.com',
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-2',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-1',
        },
        {
          endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-2',
        },
      ],
    });
  });

  test('should group endpoints for multiple domains', () => {
    const endpoints: (EndpointWithApiKey & { domain: string })[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-1',
      },
      {
        domain: 'data.example.org',
        endpoint: 'https://ghi789.execute-api.us-east-1.amazonaws.com/proxy',
        apiKey: 'test-api-key-2',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-1',
        },
      ],
      'data.example.org': [
        {
          endpoint: 'https://ghi789.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-2',
        },
      ],
    });
  });

  test('should return empty object for empty endpoints array', () => {
    const endpoints: (EndpointWithApiKey & { domain: string })[] = [];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({});
  });
});

describe('formatEndpointsJson', () => {
  test('should format endpoints as indented JSON', () => {
    const endpoints: EndpointsMap = {
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          apiKey: 'test-api-key',
        },
      ],
    };
    const result: string = formatEndpointsJson(endpoints);
    const expected =
      '{\n  "api.example.com": [\n    {\n      "endpoint": "https://abc123.execute-api.us-east-1.amazonaws.com/proxy",\n      "apiKey": "test-api-key"\n    }\n  ]\n}';
    expect(result).toBe(expected);
  });

  test('should format empty endpoints as empty object', () => {
    const endpoints: EndpointsMap = {};
    const result: string = formatEndpointsJson(endpoints);
    expect(result).toBe('{}');
  });
});

// Helper functions for mock runner
const findMatchingRegion = (
  command: string,
  stacksPerRegion: Record<string, string>,
): string | undefined => {
  for (const [region, stacks] of Object.entries(stacksPerRegion)) {
    if (command.includes(`--region ${region}`)) {
      return stacks;
    }
  }
  return undefined;
};

const findMatchingApiKey = (
  command: string,
  apiKeyMap: Record<string, string>,
): string | undefined => {
  for (const [keyId, value] of Object.entries(apiKeyMap)) {
    if (command.includes(keyId)) {
      return JSON.stringify({ value });
    }
  }
  return undefined;
};

const createMockRunner = (
  stacksPerRegion: Record<string, string>,
  apiKeyMap: Record<string, string>,
  defaultStacks: string = JSON.stringify({ Stacks: [] }),
): ((command: string) => Promise<string>) => {
  return (command: string): Promise<string> => {
    if (command.includes('describe-stacks')) {
      const match: string | undefined = findMatchingRegion(command, stacksPerRegion);
      return Promise.resolve(match ?? defaultStacks);
    }
    if (command.includes('get-api-key')) {
      const match: string | undefined = findMatchingApiKey(command, apiKeyMap);
      return Promise.resolve(match ?? '{}');
    }
    return Promise.resolve('{}');
  };
};

describe('fetchAndCollectEndpoints', () => {
  test('should fetch and collect endpoints with mock runner', async () => {
    const mockStacksApNe1: string = JSON.stringify({
      Stacks: [
        {
          StackName: 'IpRotate-api-example-com-ap-northeast-1',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com/proxy',
            },
            {
              OutputKey: 'ApiKeyId',
              OutputValue: 'test-api-key-id',
            },
          ],
        },
      ],
    });

    const mockRunner = createMockRunner(
      { 'ap-northeast-1': mockStacksApNe1 },
      { 'test-api-key-id': 'test-api-key-value' },
    );
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com/proxy',
          apiKey: 'test-api-key-value',
        },
      ],
    });
  });

  test('should return empty object when no stacks exist', async () => {
    const mockRunner = createMockRunner({}, {});
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({});
  });

  test('should return empty object when Stacks is undefined', async () => {
    const mockOutput: string = JSON.stringify({});
    const mockRunner = (_command: string): Promise<string> => Promise.resolve(mockOutput);
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({});
  });

  test('should collect endpoints from multiple stacks with different API keys', async () => {
    const mockStacksApNe1: string = JSON.stringify({
      Stacks: [
        {
          StackName: 'IpRotate-api-example-com-ap-northeast-1',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com/proxy',
            },
            {
              OutputKey: 'ApiKeyId',
              OutputValue: 'api-key-id-1',
            },
          ],
        },
      ],
    });
    const mockStacksApNe2: string = JSON.stringify({
      Stacks: [
        {
          StackName: 'IpRotate-api-example-com-ap-northeast-2',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://def456.execute-api.ap-northeast-2.amazonaws.com/proxy',
            },
            {
              OutputKey: 'ApiKeyId',
              OutputValue: 'api-key-id-2',
            },
          ],
        },
      ],
    });

    const mockRunner = createMockRunner(
      {
        'ap-northeast-1': mockStacksApNe1,
        'ap-northeast-2': mockStacksApNe2,
      },
      {
        'api-key-id-1': 'api-key-value-1',
        'api-key-id-2': 'api-key-value-2',
      },
    );
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({
      'api.example.com': [
        {
          endpoint: 'https://abc123.execute-api.ap-northeast-1.amazonaws.com/proxy',
          apiKey: 'api-key-value-1',
        },
        {
          endpoint: 'https://def456.execute-api.ap-northeast-2.amazonaws.com/proxy',
          apiKey: 'api-key-value-2',
        },
      ],
    });
  });
});
