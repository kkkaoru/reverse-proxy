// Authentication configuration tests
// Execute with bun: bun test

import { AuthorizationType } from 'aws-cdk-lib/aws-apigateway';
import { describe, expect, test } from 'vitest';
import type { ApiKeyAuthResult, IamAuthResult } from './auth.ts';
import {
  AUTH_TYPE_API_KEY,
  AUTH_TYPE_IAM,
  createIamAuth,
  isApiKeyAuth,
  isIamAuth,
} from './auth.ts';

// Note: createAuthConfig and createApiKeyAuth require actual RestApi instance
// which is tested in stack.test.ts via CDK synthesis

describe('auth', () => {
  describe('AUTH_TYPE constants', () => {
    test('AUTH_TYPE_API_KEY should be api-key', () => {
      expect(AUTH_TYPE_API_KEY).toBe('api-key');
    });

    test('AUTH_TYPE_IAM should be iam', () => {
      expect(AUTH_TYPE_IAM).toBe('iam');
    });
  });

  describe('createIamAuth', () => {
    test('should return IamAuthResult with type iam', () => {
      const result = createIamAuth();
      expect(result.type).toBe('iam');
    });

    test('should return methodOptions with IAM authorization', () => {
      const result = createIamAuth();
      expect(result.methodOptions.authorizationType).toBe(AuthorizationType.IAM);
    });
  });

  describe('isApiKeyAuth', () => {
    test('should return false for IAM auth result', () => {
      const iamResult = createIamAuth();
      expect(isApiKeyAuth(iamResult)).toBe(false);
    });

    test('should return true for API Key auth result mock', () => {
      const mockApiKeyResult: ApiKeyAuthResult = {
        type: 'api-key',
        methodOptions: { apiKeyRequired: true },
        apiKey: {} as ApiKeyAuthResult['apiKey'],
        usagePlan: {} as ApiKeyAuthResult['usagePlan'],
      };
      expect(isApiKeyAuth(mockApiKeyResult)).toBe(true);
    });
  });

  describe('isIamAuth', () => {
    test('should return true for IAM auth result', () => {
      const iamResult = createIamAuth();
      expect(isIamAuth(iamResult)).toBe(true);
    });

    test('should return false for API Key auth result mock', () => {
      const mockApiKeyResult: ApiKeyAuthResult = {
        type: 'api-key',
        methodOptions: { apiKeyRequired: true },
        apiKey: {} as ApiKeyAuthResult['apiKey'],
        usagePlan: {} as ApiKeyAuthResult['usagePlan'],
      };
      expect(isIamAuth(mockApiKeyResult)).toBe(false);
    });
  });

  describe('IamAuthResult structure', () => {
    test('should have type property', () => {
      const result: IamAuthResult = createIamAuth();
      expect(Object.hasOwn(result, 'type')).toBe(true);
    });

    test('should have methodOptions property', () => {
      const result: IamAuthResult = createIamAuth();
      expect(Object.hasOwn(result, 'methodOptions')).toBe(true);
    });
  });
});
