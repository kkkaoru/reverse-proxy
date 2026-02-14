// CDK App tests
// Execute with vitest: vitest run

import { App } from 'aws-cdk-lib';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { ParsedConfig, StackConfig, TargetDomain } from './app.ts';
import {
  buildStackConfigsForDomain,
  buildStackId,
  createAllStacks,
  createGatewayIndices,
  createStackForDomainRegion,
  createStackProps,
  getEnvOrContext,
  parseConfig,
  parseGatewayPerRegion,
  parseProtocol,
  parseSingleDomain,
  parseTargetDomains,
  sanitizeHostForStackId,
  validateConfig,
} from './app.ts';

// Helper to save and restore environment variables
interface EnvHelper {
  readonly save: (keys: string[]) => void;
  readonly set: (key: string, value: string) => void;
  readonly clear: (key: string) => void;
  readonly restore: () => void;
}

const createEnvHelper = (): EnvHelper => {
  const savedEnv: Record<string, string | undefined> = {};

  return {
    save: (keys: string[]): void => {
      for (const key of keys) {
        savedEnv[key] = process.env[key];
      }
    },
    set: (key: string, value: string): void => {
      process.env[key] = value;
    },
    clear: (key: string): void => {
      delete process.env[key];
    },
    restore: (): void => {
      for (const [key, value] of Object.entries(savedEnv)) {
        if (value === undefined) {
          delete process.env[key];
        } else {
          process.env[key] = value;
        }
      }
    },
  };
};

const envHelper: EnvHelper = createEnvHelper();

describe('parseProtocol', () => {
  test('should return http for http string', () => {
    const result = parseProtocol('http');
    expect(result).toBe('http');
  });

  test('should return https for https string', () => {
    const result = parseProtocol('https');
    expect(result).toBe('https');
  });

  test('should return https for unknown protocol', () => {
    const result = parseProtocol('ftp');
    expect(result).toBe('https');
  });

  test('should return https for empty string', () => {
    const result = parseProtocol('');
    expect(result).toBe('https');
  });
});

describe('parseSingleDomain', () => {
  test('should parse https domain correctly', () => {
    const result = parseSingleDomain('https:api.example.com');
    expect(result).toStrictEqual({ protocol: 'https', host: 'api.example.com' });
  });

  test('should parse http domain correctly', () => {
    const result = parseSingleDomain('http:api.example.com');
    expect(result).toStrictEqual({ protocol: 'http', host: 'api.example.com' });
  });

  test('should trim whitespace from host', () => {
    const result = parseSingleDomain('https:  api.example.com  ');
    expect(result).toStrictEqual({ protocol: 'https', host: 'api.example.com' });
  });

  test('should return null for string without separator', () => {
    const result = parseSingleDomain('api.example.com');
    expect(result).toBeNull();
  });

  test('should return null for empty string', () => {
    const result = parseSingleDomain('');
    expect(result).toBeNull();
  });

  test('should handle domain with port', () => {
    const result = parseSingleDomain('https:api.example.com:8080');
    expect(result).toStrictEqual({ protocol: 'https', host: 'api.example.com:8080' });
  });

  test('should return null when protocol is empty', () => {
    const result = parseSingleDomain(':api.example.com');
    expect(result).toBeNull();
  });

  test('should return null when host is empty', () => {
    const result = parseSingleDomain('https:');
    expect(result).toBeNull();
  });
});

describe('parseTargetDomains', () => {
  test('should return empty array for undefined', () => {
    const result = parseTargetDomains(undefined);
    expect(result).toStrictEqual([]);
  });

  test('should return empty array for empty string', () => {
    const result = parseTargetDomains('');
    expect(result).toStrictEqual([]);
  });

  test('should parse single domain', () => {
    const result = parseTargetDomains('https:api.example.com');
    expect(result).toStrictEqual([{ protocol: 'https', host: 'api.example.com' }]);
  });

  test('should parse multiple domains', () => {
    const result = parseTargetDomains('https:api.example.com,http:data.example.org');
    expect(result).toStrictEqual([
      { protocol: 'https', host: 'api.example.com' },
      { protocol: 'http', host: 'data.example.org' },
    ]);
  });

  test('should filter out invalid domains', () => {
    const result = parseTargetDomains('https:api.example.com,invalid,http:data.example.org');
    expect(result).toStrictEqual([
      { protocol: 'https', host: 'api.example.com' },
      { protocol: 'http', host: 'data.example.org' },
    ]);
  });

  test('should trim whitespace between domains', () => {
    const result = parseTargetDomains('  https:api.example.com  ,  http:data.example.org  ');
    expect(result).toStrictEqual([
      { protocol: 'https', host: 'api.example.com' },
      { protocol: 'http', host: 'data.example.org' },
    ]);
  });
});

describe('sanitizeHostForStackId', () => {
  test('should replace dots with dashes', () => {
    const result = sanitizeHostForStackId('api.example.com');
    expect(result).toBe('api-example-com');
  });

  test('should remove invalid characters', () => {
    const result = sanitizeHostForStackId('api_test.example.com:8080');
    expect(result).toBe('apitest-example-com8080');
  });

  test('should handle empty string', () => {
    const result = sanitizeHostForStackId('');
    expect(result).toBe('');
  });

  test('should keep alphanumeric and dashes', () => {
    const result = sanitizeHostForStackId('api-v2.example.com');
    expect(result).toBe('api-v2-example-com');
  });
});

describe('parseGatewayPerRegion', () => {
  test('should return 1 for undefined', () => {
    expect(parseGatewayPerRegion(undefined)).toBe(1);
  });

  test('should return 1 for empty string', () => {
    expect(parseGatewayPerRegion('')).toBe(1);
  });

  test('should return 3 for "3"', () => {
    expect(parseGatewayPerRegion('3')).toBe(3);
  });

  test('should return 1 for "0" (clamp to min)', () => {
    expect(parseGatewayPerRegion('0')).toBe(1);
  });

  test('should return 1 for negative value', () => {
    expect(parseGatewayPerRegion('-5')).toBe(1);
  });

  test('should return 1 for non-numeric string', () => {
    expect(parseGatewayPerRegion('abc')).toBe(1);
  });

  test('should return 10 for "10"', () => {
    expect(parseGatewayPerRegion('10')).toBe(10);
  });
});

describe('createGatewayIndices', () => {
  test('should return [1] for count 1', () => {
    expect(createGatewayIndices(1)).toStrictEqual([1]);
  });

  test('should return [1, 2, 3] for count 3', () => {
    expect(createGatewayIndices(3)).toStrictEqual([1, 2, 3]);
  });

  test('should return empty array for count 0', () => {
    expect(createGatewayIndices(0)).toStrictEqual([]);
  });
});

describe('buildStackId', () => {
  test('should build stack ID with prefix, host, region and gateway index', () => {
    const result = buildStackId('api.example.com', 'us-east-1', 1);
    expect(result).toBe('IpRotate-api-example-com-us-east-1-gw1');
  });

  test('should sanitize host in stack ID', () => {
    const result = buildStackId('api_test.example.com:8080', 'eu-west-1', 1);
    expect(result).toBe('IpRotate-apitest-example-com8080-eu-west-1-gw1');
  });

  test('should include gateway index 2', () => {
    const result = buildStackId('api.example.com', 'us-east-1', 2);
    expect(result).toBe('IpRotate-api-example-com-us-east-1-gw2');
  });

  test('should include gateway index 3', () => {
    const result = buildStackId('api.example.com', 'ap-northeast-1', 3);
    expect(result).toBe('IpRotate-api-example-com-ap-northeast-1-gw3');
  });
});

describe('getEnvOrContext', () => {
  const testEnvKeys = ['CDK_DEFAULT_ACCOUNT', 'TEST_ENV_VAR'];

  beforeEach(() => {
    envHelper.save(testEnvKeys);
    // Clear env vars for clean test state
    for (const key of testEnvKeys) {
      envHelper.clear(key);
    }
  });

  afterEach(() => {
    envHelper.restore();
  });

  test('should return env value when set', () => {
    envHelper.set('TEST_ENV_VAR', 'env-value');
    const app = new App();
    const result = getEnvOrContext({
      app,
      envKey: 'TEST_ENV_VAR',
      contextKey: 'testContext',
    });
    expect(result).toBe('env-value');
  });

  test('should return context value when env not set', () => {
    const app = new App({ context: { testContext: 'context-value' } });
    const result = getEnvOrContext({
      app,
      envKey: 'NONEXISTENT_ENV_VAR',
      contextKey: 'testContext',
    });
    expect(result).toBe('context-value');
  });

  test('should return undefined when neither env nor context set', () => {
    const app = new App();
    const result = getEnvOrContext({
      app,
      envKey: 'NONEXISTENT_ENV_VAR',
      contextKey: 'nonexistentContext',
    });
    expect(result).toBeUndefined();
  });

  test('should prefer env value over context value', () => {
    envHelper.set('TEST_ENV_VAR', 'env-value');
    const app = new App({ context: { testContext: 'context-value' } });
    const result = getEnvOrContext({
      app,
      envKey: 'TEST_ENV_VAR',
      contextKey: 'testContext',
    });
    expect(result).toBe('env-value');
  });
});

describe('parseConfig', () => {
  const configEnvKeys = [
    'CDK_DEFAULT_ACCOUNT',
    'TARGET_DOMAINS',
    'REGIONS',
    'STAGE_NAME',
    'AUTH_TYPE',
    'API_GATEWAY_PER_REGION',
  ];

  beforeEach(() => {
    envHelper.save(configEnvKeys);
    // Clear env vars for clean test state
    for (const key of configEnvKeys) {
      envHelper.clear(key);
    }
  });

  afterEach(() => {
    envHelper.restore();
  });

  test('should parse config with all env vars set', () => {
    envHelper.set('CDK_DEFAULT_ACCOUNT', '123456789012');
    envHelper.set('TARGET_DOMAINS', 'https:api.example.com');
    envHelper.set('REGIONS', 'us-east-1');
    envHelper.set('STAGE_NAME', 'test');
    envHelper.set('AUTH_TYPE', 'iam');
    envHelper.set('API_GATEWAY_PER_REGION', '3');

    const app = new App();
    const result = parseConfig(app);

    expect(result.account).toBe('123456789012');
    expect(result.domains).toStrictEqual([{ protocol: 'https', host: 'api.example.com' }]);
    expect(result.regions).toStrictEqual(['us-east-1']);
    expect(result.stageName).toBe('test');
    expect(result.authType).toBe('iam');
    expect(result.gatewayPerRegion).toBe(3);
  });

  test('should use default values when env vars not set', () => {
    const app = new App();
    const result = parseConfig(app);

    expect(result.account).toBe('');
    expect(result.domains).toStrictEqual([]);
    expect(result.stageName).toBe('proxy');
    expect(result.authType).toBe('api-key');
    expect(result.gatewayPerRegion).toBe(1);
  });

  test('should use context values when env vars not set', () => {
    const app = new App({
      context: {
        targetDomains: 'https:api.example.com',
        regions: 'eu-west-1',
        stageName: 'staging',
        authType: 'iam',
      },
    });
    const result = parseConfig(app);

    expect(result.domains).toStrictEqual([{ protocol: 'https', host: 'api.example.com' }]);
    expect(result.regions).toStrictEqual(['eu-west-1']);
    expect(result.stageName).toBe('staging');
    expect(result.authType).toBe('iam');
    expect(result.gatewayPerRegion).toBe(1);
  });
});

describe('validateConfig', () => {
  test('should return valid for config with domains and regions', () => {
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };
    const result = validateConfig(config);
    expect(result).toStrictEqual({ valid: true });
  });

  test('should return error for empty domains', () => {
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };
    const result = validateConfig(config);
    expect(result).toStrictEqual({
      valid: false,
      message:
        'Error: TARGET_DOMAINS is required. Format: https:api.example.com,https:data.example.org',
    });
  });

  test('should return error for empty regions', () => {
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: [],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };
    const result = validateConfig(config);
    expect(result).toStrictEqual({
      valid: false,
      message: 'Error: No valid regions specified.',
    });
  });
});

describe('createStackProps', () => {
  test('should create stack props from config', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: StackConfig = {
      domain,
      region: 'us-east-1',
      account: '123456789012',
      stageName: 'proxy',
      authType: 'api-key',
      gatewayIndex: 1,
    };
    const result = createStackProps(config);

    expect(result.targetHost).toBe('api.example.com');
    expect(result.targetProtocol).toBe('https');
    expect(result.stageName).toBe('proxy');
    expect(result.authType).toBe('api-key');
    expect(result.env).toStrictEqual({ account: '123456789012', region: 'us-east-1' });
  });

  test('should create stack props with http protocol', () => {
    const domain: TargetDomain = { protocol: 'http', host: 'api.example.com' };
    const config: StackConfig = {
      domain,
      region: 'eu-west-1',
      account: '987654321098',
      stageName: 'staging',
      authType: 'iam',
      gatewayIndex: 1,
    };
    const result = createStackProps(config);

    expect(result.targetHost).toBe('api.example.com');
    expect(result.targetProtocol).toBe('http');
    expect(result.stageName).toBe('staging');
    expect(result.authType).toBe('iam');
    expect(result.env).toStrictEqual({ account: '987654321098', region: 'eu-west-1' });
  });
});

describe('buildStackConfigsForDomain', () => {
  test('should build configs for single region with default gateway count', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'us-east-1',
        account: '123456789012',
        stageName: 'proxy',
        authType: 'api-key',
        apiKeyValue: undefined,
        gatewayIndex: 1,
      },
    ]);
  });

  test('should build configs for multiple regions with default gateway count', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'prod',
      authType: 'iam',
      gatewayPerRegion: 1,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'us-east-1',
        account: '123456789012',
        stageName: 'prod',
        authType: 'iam',
        apiKeyValue: undefined,
        gatewayIndex: 1,
      },
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'eu-west-1',
        account: '123456789012',
        stageName: 'prod',
        authType: 'iam',
        apiKeyValue: undefined,
        gatewayIndex: 1,
      },
    ]);
  });

  test('should build configs for single region with 3 gateways per region', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 3,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toHaveLength(3);
    expect(result[0]?.gatewayIndex).toBe(1);
    expect(result[1]?.gatewayIndex).toBe(2);
    expect(result[2]?.gatewayIndex).toBe(3);
    expect(result[0]?.region).toBe('us-east-1');
    expect(result[1]?.region).toBe('us-east-1');
    expect(result[2]?.region).toBe('us-east-1');
  });

  test('should build configs for 2 regions with 2 gateways per region', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 2,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toHaveLength(4);
    expect(result[0]?.region).toBe('us-east-1');
    expect(result[0]?.gatewayIndex).toBe(1);
    expect(result[1]?.region).toBe('us-east-1');
    expect(result[1]?.gatewayIndex).toBe(2);
    expect(result[2]?.region).toBe('eu-west-1');
    expect(result[2]?.gatewayIndex).toBe(1);
    expect(result[3]?.region).toBe('eu-west-1');
    expect(result[3]?.gatewayIndex).toBe(2);
  });

  test('should return empty array for empty regions', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: [],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([]);
  });

  test('should include apiKeyValue when provided', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      apiKeyValue: 'shared-api-key',
      gatewayPerRegion: 1,
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'us-east-1',
        account: '123456789012',
        stageName: 'proxy',
        authType: 'api-key',
        apiKeyValue: 'shared-api-key',
        gatewayIndex: 1,
      },
    ]);
  });
});

describe('createStackForDomainRegion', () => {
  test('should create stack and return IpRotateStack instance', () => {
    const app = new App();
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: StackConfig = {
      domain,
      region: 'us-east-1',
      account: '123456789012',
      stageName: 'proxy',
      authType: 'api-key',
      gatewayIndex: 1,
    };

    const result = createStackForDomainRegion(app, config);

    expect(result).toBeDefined();
    expect(result.stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
  });

  test('should create stack with sanitized host in stack name', () => {
    const app = new App();
    const domain: TargetDomain = { protocol: 'http', host: 'api.test.example.com' };
    const config: StackConfig = {
      domain,
      region: 'eu-west-1',
      account: '987654321098',
      stageName: 'staging',
      authType: 'iam',
      gatewayIndex: 1,
    };

    const result = createStackForDomainRegion(app, config);

    expect(result).toBeDefined();
    expect(result.stackName).toBe('IpRotate-api-test-example-com-eu-west-1-gw1');
  });

  test('should include gateway index 2 in stack name', () => {
    const app = new App();
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: StackConfig = {
      domain,
      region: 'us-east-1',
      account: '123456789012',
      stageName: 'proxy',
      authType: 'api-key',
      gatewayIndex: 2,
    };

    const result = createStackForDomainRegion(app, config);

    expect(result).toBeDefined();
    expect(result.stackName).toBe('IpRotate-api-example-com-us-east-1-gw2');
  });
});

describe('createAllStacks', () => {
  test('should create stacks for single domain and single region', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(1);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
  });

  test('should create stacks for single domain and multiple regions', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(2);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-eu-west-1-gw1');
  });

  test('should create stacks for multiple domains and multiple regions', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [
        { protocol: 'https', host: 'api.example.com' },
        { protocol: 'http', host: 'data.example.org' },
      ],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'prod',
      authType: 'iam',
      gatewayPerRegion: 1,
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(4);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-eu-west-1-gw1');
    expect(result[2].stackName).toBe('IpRotate-data-example-org-us-east-1-gw1');
    expect(result[3].stackName).toBe('IpRotate-data-example-org-eu-west-1-gw1');
  });

  test('should create stacks with multiple gateways per region', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 2,
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(2);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-us-east-1-gw2');
  });

  test('should create stacks for 2 regions with 3 gateways each', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 3,
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(6);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1-gw1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-us-east-1-gw2');
    expect(result[2].stackName).toBe('IpRotate-api-example-com-us-east-1-gw3');
    expect(result[3].stackName).toBe('IpRotate-api-example-com-eu-west-1-gw1');
    expect(result[4].stackName).toBe('IpRotate-api-example-com-eu-west-1-gw2');
    expect(result[5].stackName).toBe('IpRotate-api-example-com-eu-west-1-gw3');
  });

  test('should return empty array for empty domains', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };

    const result = createAllStacks({ app, config });

    expect(result).toStrictEqual([]);
  });

  test('should return empty array for empty regions', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: [],
      stageName: 'proxy',
      authType: 'api-key',
      gatewayPerRegion: 1,
    };

    const result = createAllStacks({ app, config });

    expect(result).toStrictEqual([]);
  });
});
