// Export endpoints tests
// Execute with bun: bun test

import { describe, expect, test } from 'vitest';
import type {
  AccumulatorState,
  DescribeStacksResponse,
  EndpointsMap,
  FetchEndpointsParams,
  StackDescription,
  StackEndpoint,
  StackNameResult,
  StackOutput,
} from './export-endpoints.ts';
import {
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
} from './export-endpoints.ts';

describe('parseStackName', () => {
  test('should parse valid stack name with single domain part', () => {
    const result: StackNameResult = parseStackName('IpRotate-example-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'example' });
  });

  test('should parse valid stack name with multiple domain parts', () => {
    const result: StackNameResult = parseStackName('IpRotate-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'api.example.com' });
  });

  test('should parse valid stack name with different region', () => {
    const result: StackNameResult = parseStackName('IpRotate-data-test-org-eu-west-1');
    expect(result).toStrictEqual({ valid: true, domain: 'data.test.org' });
  });

  test('should return invalid for stack name without prefix', () => {
    const result: StackNameResult = parseStackName('OtherStack-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '' });
  });

  test('should return invalid for stack name with too few parts', () => {
    const result: StackNameResult = parseStackName('IpRotate-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '' });
  });

  test('should return invalid for empty stack name', () => {
    const result: StackNameResult = parseStackName('');
    expect(result).toStrictEqual({ valid: false, domain: '' });
  });

  test('should return invalid for stack name with only prefix', () => {
    const result: StackNameResult = parseStackName('IpRotate-');
    expect(result).toStrictEqual({ valid: false, domain: '' });
  });
});

describe('buildValidStackName', () => {
  test('should build valid result for stack name with enough parts', () => {
    const result: StackNameResult = buildValidStackName('IpRotate-api-example-com-us-east-1');
    expect(result).toStrictEqual({ valid: true, domain: 'api.example.com' });
  });

  test('should return invalid for stack name with too few parts', () => {
    const result: StackNameResult = buildValidStackName('IpRotate-us-east-1');
    expect(result).toStrictEqual({ valid: false, domain: '' });
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
      ],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toStrictEqual({
      domain: 'api.example.com',
      endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
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
      ],
    };
    const result: StackEndpoint | null = extractStackEndpoint(stack);
    expect(result).toBeNull();
  });

  test('should return null for stack without ApiEndpoint output', () => {
    const stack: StackDescription = {
      StackName: 'IpRotate-api-example-com-us-east-1',
      Outputs: [{ OutputKey: 'OtherOutput', OutputValue: 'some-value' }],
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
      },
    };
    const result: Record<string, string[]> = addEndpointToAccumulator(state);
    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
    });
  });

  test('should add endpoint to existing domain', () => {
    const state: AccumulatorState = {
      acc: { 'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'] },
      item: {
        domain: 'api.example.com',
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      },
    };
    const result: Record<string, string[]> = addEndpointToAccumulator(state);
    expect(result).toStrictEqual({
      'api.example.com': [
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      ],
    });
  });
});

describe('groupEndpointsByDomain', () => {
  test('should group single endpoint', () => {
    const endpoints: readonly StackEndpoint[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
    });
  });

  test('should group multiple endpoints for same domain', () => {
    const endpoints: readonly StackEndpoint[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      },
      {
        domain: 'api.example.com',
        endpoint: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': [
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      ],
    });
  });

  test('should group endpoints for multiple domains', () => {
    const endpoints: readonly StackEndpoint[] = [
      {
        domain: 'api.example.com',
        endpoint: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
      },
      {
        domain: 'data.example.org',
        endpoint: 'https://ghi789.execute-api.us-east-1.amazonaws.com/proxy',
      },
    ];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
      'data.example.org': ['https://ghi789.execute-api.us-east-1.amazonaws.com/proxy'],
    });
  });

  test('should return empty object for empty endpoints array', () => {
    const endpoints: readonly StackEndpoint[] = [];
    const result: EndpointsMap = groupEndpointsByDomain(endpoints);
    expect(result).toStrictEqual({});
  });
});

describe('collectEndpoints', () => {
  test('should collect endpoints from valid stacks', () => {
    const stacks: readonly StackDescription[] = [
      {
        StackName: 'IpRotate-api-example-com-us-east-1',
        Outputs: [
          {
            OutputKey: 'ApiEndpoint',
            OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          },
        ],
      },
      {
        StackName: 'IpRotate-api-example-com-eu-west-1',
        Outputs: [
          {
            OutputKey: 'ApiEndpoint',
            OutputValue: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
          },
        ],
      },
    ];
    const result: EndpointsMap = collectEndpoints(stacks);
    expect(result).toStrictEqual({
      'api.example.com': [
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      ],
    });
  });

  test('should filter out invalid stacks', () => {
    const stacks: readonly StackDescription[] = [
      {
        StackName: 'IpRotate-api-example-com-us-east-1',
        Outputs: [
          {
            OutputKey: 'ApiEndpoint',
            OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          },
        ],
      },
      {
        StackName: 'OtherStack-test',
        Outputs: [{ OutputKey: 'ApiEndpoint', OutputValue: 'https://other.example.com' }],
      },
    ];
    const result: EndpointsMap = collectEndpoints(stacks);
    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
    });
  });

  test('should return empty object for empty stacks', () => {
    const stacks: readonly StackDescription[] = [];
    const result: EndpointsMap = collectEndpoints(stacks);
    expect(result).toStrictEqual({});
  });

  test('should collect endpoints from multiple domains', () => {
    const stacks: readonly StackDescription[] = [
      {
        StackName: 'IpRotate-api-example-com-us-east-1',
        Outputs: [
          {
            OutputKey: 'ApiEndpoint',
            OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
          },
        ],
      },
      {
        StackName: 'IpRotate-data-test-org-ap-northeast-1',
        Outputs: [
          {
            OutputKey: 'ApiEndpoint',
            OutputValue: 'https://xyz789.execute-api.ap-northeast-1.amazonaws.com/proxy',
          },
        ],
      },
    ];
    const result: EndpointsMap = collectEndpoints(stacks);
    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
      'data.test.org': ['https://xyz789.execute-api.ap-northeast-1.amazonaws.com/proxy'],
    });
  });
});

describe('formatEndpointsJson', () => {
  test('should format endpoints as indented JSON', () => {
    const endpoints: EndpointsMap = {
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
    };
    const result: string = formatEndpointsJson(endpoints);
    expect(result).toBe(
      '{\n  "api.example.com": [\n    "https://abc123.execute-api.us-east-1.amazonaws.com/proxy"\n  ]\n}',
    );
  });

  test('should format empty endpoints as empty object', () => {
    const endpoints: EndpointsMap = {};
    const result: string = formatEndpointsJson(endpoints);
    expect(result).toBe('{}');
  });
});

describe('fetchAndCollectEndpoints', () => {
  test('should fetch and collect endpoints with mock runner', async () => {
    const mockOutput: string = JSON.stringify({
      Stacks: [
        {
          StackName: 'IpRotate-api-example-com-us-east-1',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
            },
          ],
        },
      ],
    });
    const mockRunner = async (_command: string): Promise<string> => mockOutput;
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({
      'api.example.com': ['https://abc123.execute-api.us-east-1.amazonaws.com/proxy'],
    });
  });

  test('should return empty object when no stacks exist', async () => {
    const mockOutput: string = JSON.stringify({ Stacks: [] });
    const mockRunner = async (_command: string): Promise<string> => mockOutput;
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({});
  });

  test('should return empty object when Stacks is undefined', async () => {
    const mockOutput: string = JSON.stringify({});
    const mockRunner = async (_command: string): Promise<string> => mockOutput;
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({});
  });

  test('should collect endpoints from multiple stacks', async () => {
    const mockOutput: string = JSON.stringify({
      Stacks: [
        {
          StackName: 'IpRotate-api-example-com-us-east-1',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
            },
          ],
        },
        {
          StackName: 'IpRotate-api-example-com-eu-west-1',
          Outputs: [
            {
              OutputKey: 'ApiEndpoint',
              OutputValue: 'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
            },
          ],
        },
      ],
    });
    const mockRunner = async (_command: string): Promise<string> => mockOutput;
    const params: FetchEndpointsParams = { runCommand: mockRunner };

    const result: EndpointsMap = await fetchAndCollectEndpoints(params);

    expect(result).toStrictEqual({
      'api.example.com': [
        'https://abc123.execute-api.us-east-1.amazonaws.com/proxy',
        'https://def456.execute-api.eu-west-1.amazonaws.com/proxy',
      ],
    });
  });
});
