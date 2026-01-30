// CDK App tests
// Execute with vitest: vitest run

import { App } from 'aws-cdk-lib';
import { afterEach, describe, expect, test, vi } from 'vitest';
import type { ParsedConfig, StackConfig, TargetDomain } from './app.ts';
import {
  buildStackConfigsForDomain,
  buildStackId,
  createAllStacks,
  createStackForDomainRegion,
  createStackProps,
  getEnvOrContext,
  parseConfig,
  parseProtocol,
  parseSingleDomain,
  parseTargetDomains,
  sanitizeHostForStackId,
  validateConfig,
} from './app.ts';

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

describe('buildStackId', () => {
  test('should build stack ID with prefix, host and region', () => {
    const result = buildStackId('api.example.com', 'us-east-1');
    expect(result).toBe('IpRotate-api-example-com-us-east-1');
  });

  test('should sanitize host in stack ID', () => {
    const result = buildStackId('api_test.example.com:8080', 'eu-west-1');
    expect(result).toBe('IpRotate-apitest-example-com8080-eu-west-1');
  });
});

describe('getEnvOrContext', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('should return env value when set', () => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', 'env-value');
    const app = new App();
    const result = getEnvOrContext({
      app,
      envKey: 'CDK_DEFAULT_ACCOUNT',
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
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', 'env-value');
    const app = new App({ context: { testContext: 'context-value' } });
    const result = getEnvOrContext({
      app,
      envKey: 'CDK_DEFAULT_ACCOUNT',
      contextKey: 'testContext',
    });
    expect(result).toBe('env-value');
  });
});

describe('parseConfig', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  test('should parse config with all env vars set', () => {
    vi.stubEnv('CDK_DEFAULT_ACCOUNT', '123456789012');
    vi.stubEnv('TARGET_DOMAINS', 'https:api.example.com');
    vi.stubEnv('REGIONS', 'us-east-1');
    vi.stubEnv('STAGE_NAME', 'test');
    vi.stubEnv('AUTH_TYPE', 'iam');

    const app = new App();
    const result = parseConfig(app);

    expect(result.account).toBe('123456789012');
    expect(result.domains).toStrictEqual([{ protocol: 'https', host: 'api.example.com' }]);
    expect(result.regions).toStrictEqual(['us-east-1']);
    expect(result.stageName).toBe('test');
    expect(result.authType).toBe('iam');
  });

  test('should use default values when env vars not set', () => {
    const app = new App();
    const result = parseConfig(app);

    expect(result.account).toBe('');
    expect(result.domains).toStrictEqual([]);
    expect(result.stageName).toBe('proxy');
    expect(result.authType).toBe('api-key');
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
  test('should build configs for single region', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'us-east-1',
        account: '123456789012',
        stageName: 'proxy',
        authType: 'api-key',
      },
    ]);
  });

  test('should build configs for multiple regions', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: ['us-east-1', 'eu-west-1', 'ap-northeast-1'],
      stageName: 'prod',
      authType: 'iam',
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'us-east-1',
        account: '123456789012',
        stageName: 'prod',
        authType: 'iam',
      },
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'eu-west-1',
        account: '123456789012',
        stageName: 'prod',
        authType: 'iam',
      },
      {
        domain: { protocol: 'https', host: 'api.example.com' },
        region: 'ap-northeast-1',
        account: '123456789012',
        stageName: 'prod',
        authType: 'iam',
      },
    ]);
  });

  test('should return empty array for empty regions', () => {
    const domain: TargetDomain = { protocol: 'https', host: 'api.example.com' };
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [domain],
      regions: [],
      stageName: 'proxy',
      authType: 'api-key',
    };
    const result = buildStackConfigsForDomain(domain, config);

    expect(result).toStrictEqual([]);
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
    };

    const result = createStackForDomainRegion(app, config);

    expect(result).toBeDefined();
    expect(result.stackName).toBe('IpRotate-api-example-com-us-east-1');
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
    };

    const result = createStackForDomainRegion(app, config);

    expect(result).toBeDefined();
    expect(result.stackName).toBe('IpRotate-api-test-example-com-eu-west-1');
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
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(1);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1');
  });

  test('should create stacks for single domain and multiple regions', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [{ protocol: 'https', host: 'api.example.com' }],
      regions: ['us-east-1', 'eu-west-1'],
      stageName: 'proxy',
      authType: 'api-key',
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(2);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-eu-west-1');
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
    };

    const result = createAllStacks({ app, config });

    expect(result).toHaveLength(4);
    expect(result[0].stackName).toBe('IpRotate-api-example-com-us-east-1');
    expect(result[1].stackName).toBe('IpRotate-api-example-com-eu-west-1');
    expect(result[2].stackName).toBe('IpRotate-data-example-org-us-east-1');
    expect(result[3].stackName).toBe('IpRotate-data-example-org-eu-west-1');
  });

  test('should return empty array for empty domains', () => {
    const app = new App();
    const config: ParsedConfig = {
      account: '123456789012',
      domains: [],
      regions: ['us-east-1'],
      stageName: 'proxy',
      authType: 'api-key',
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
    };

    const result = createAllStacks({ app, config });

    expect(result).toStrictEqual([]);
  });
});
