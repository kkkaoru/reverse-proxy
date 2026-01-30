// IP Rotate Stack tests
// Execute with bun: bun test

import { App } from 'aws-cdk-lib';
import { Template } from 'aws-cdk-lib/assertions';
import { describe, expect, test } from 'vitest';
import type { IpRotateStackProps } from './stack.ts';
import { IpRotateStack } from './stack.ts';

const createTestApp = (): App => new App();

const createTestStackProps = (overrides: Partial<IpRotateStackProps> = {}): IpRotateStackProps => ({
  targetHost: 'api.example.com',
  targetProtocol: 'https',
  stageName: 'proxy',
  authType: 'api-key',
  env: { account: '123456789012', region: 'us-east-1' },
  ...overrides,
});

describe('IpRotateStack', () => {
  describe('with API Key auth', () => {
    test('should create REST API resource', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    test('should create API Gateway deployment', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::Deployment', 1);
    });

    test('should create API Gateway stage with correct name', () => {
      const app = createTestApp();
      const props = createTestStackProps({ stageName: 'prod' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Stage', {
        StageName: 'prod',
      });
    });

    test('should create proxy resource', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Resource', {
        PathPart: '{proxy+}',
      });
    });

    test('should create API Key', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::ApiKey', 1);
    });

    test('should create Usage Plan', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::UsagePlan', {
        UsagePlanName: 'IpRotateUsagePlan',
      });
    });

    test('should create method with API key required', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'ANY',
        ApiKeyRequired: true,
      });
    });

    test('should have apiEndpoint property', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);

      expect(stack.apiEndpoint).toBeDefined();
    });

    test('should have apiId property', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);

      expect(stack.apiId).toBeDefined();
    });

    test('should have apiKeyId property for API Key auth', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);

      expect(stack.apiKeyId).toBeDefined();
    });
  });

  describe('with IAM auth', () => {
    test('should create REST API resource', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    });

    test('should not create API Key', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::ApiKey', 0);
    });

    test('should not create Usage Plan', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.resourceCountIs('AWS::ApiGateway::UsagePlan', 0);
    });

    test('should create method with IAM authorization', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        HttpMethod: 'ANY',
        AuthorizationType: 'AWS_IAM',
      });
    });

    test('should not have apiKeyId property for IAM auth', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);

      expect(stack.apiKeyId).toBeUndefined();
    });
  });

  describe('HTTP integration', () => {
    test('should configure HTTPS integration for https protocol', () => {
      const app = createTestApp();
      const props = createTestStackProps({
        targetProtocol: 'https',
        targetHost: 'test.example.com',
      });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'HTTP_PROXY',
          Uri: 'https://test.example.com/{proxy}',
        },
      });
    });

    test('should configure HTTP integration for http protocol', () => {
      const app = createTestApp();
      const props = createTestStackProps({
        targetProtocol: 'http',
        targetHost: 'test.example.com',
      });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasResourceProperties('AWS::ApiGateway::Method', {
        Integration: {
          Type: 'HTTP_PROXY',
          Uri: 'http://test.example.com/{proxy}',
        },
      });
    });
  });

  describe('CloudFormation outputs', () => {
    test('should output ApiEndpoint', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasOutput('ApiEndpoint', {});
    });

    test('should output ApiId', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasOutput('ApiId', {});
    });

    test('should output ApiKeyId for API Key auth', () => {
      const app = createTestApp();
      const props = createTestStackProps();
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      template.hasOutput('ApiKeyId', {});
    });

    test('should not output ApiKeyId for IAM auth', () => {
      const app = createTestApp();
      const props = createTestStackProps({ authType: 'iam' });
      const stack = new IpRotateStack(app, 'TestStack', props);
      const template = Template.fromStack(stack);

      expect(() => template.hasOutput('ApiKeyId', {})).toThrow();
    });
  });
});
