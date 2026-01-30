// Authentication configuration for IP Rotate CDK
// Execute with bun: bunx cdk synth

import type { IApiKey, MethodOptions, RestApi, UsagePlan } from 'aws-cdk-lib/aws-apigateway';
import { AuthorizationType } from 'aws-cdk-lib/aws-apigateway';

type AuthType = 'api-key' | 'iam';

// Interfaces at top
interface AuthConfig {
  readonly authType: AuthType;
}

interface ApiKeyAuthResult {
  readonly type: 'api-key';
  readonly methodOptions: MethodOptions;
  readonly apiKey: IApiKey;
  readonly usagePlan: UsagePlan;
}

interface IamAuthResult {
  readonly type: 'iam';
  readonly methodOptions: MethodOptions;
}

type AuthResult = ApiKeyAuthResult | IamAuthResult;

interface UsagePlanThrottle {
  readonly rateLimit: number;
  readonly burstLimit: number;
}

// Constants at top
const AUTH_TYPE_API_KEY = 'api-key';
const AUTH_TYPE_IAM = 'iam';
const USAGE_PLAN_NAME = 'IpRotateUsagePlan';
const RATE_LIMIT = 100;
const BURST_LIMIT = 200;

// Pure functions
const createUsagePlanThrottle = (): UsagePlanThrottle => ({
  rateLimit: RATE_LIMIT,
  burstLimit: BURST_LIMIT,
});

const createApiKeyAuth = (api: RestApi): ApiKeyAuthResult => {
  const apiKey: IApiKey = api.addApiKey('ApiKey');
  const usagePlan: UsagePlan = api.addUsagePlan('UsagePlan', {
    name: USAGE_PLAN_NAME,
    throttle: createUsagePlanThrottle(),
  });
  usagePlan.addApiKey(apiKey);
  usagePlan.addApiStage({ stage: api.deploymentStage });
  return {
    type: AUTH_TYPE_API_KEY,
    methodOptions: { apiKeyRequired: true },
    apiKey,
    usagePlan,
  };
};

const createIamAuth = (): IamAuthResult => ({
  type: AUTH_TYPE_IAM,
  methodOptions: { authorizationType: AuthorizationType.IAM },
});

const createAuthConfig = (api: RestApi, authType: string): AuthResult =>
  authType === AUTH_TYPE_IAM ? createIamAuth() : createApiKeyAuth(api);

const isApiKeyAuth = (result: AuthResult): result is ApiKeyAuthResult =>
  result.type === AUTH_TYPE_API_KEY;

const isIamAuth = (result: AuthResult): result is IamAuthResult => result.type === AUTH_TYPE_IAM;

export { createAuthConfig, createApiKeyAuth, createIamAuth, isApiKeyAuth, isIamAuth };
export { AUTH_TYPE_API_KEY, AUTH_TYPE_IAM };
export type { AuthConfig, AuthResult, ApiKeyAuthResult, IamAuthResult };
