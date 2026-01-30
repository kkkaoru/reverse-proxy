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

interface CreateApiKeyAuthParams {
  readonly api: RestApi;
  readonly apiKeyValue?: string;
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

const createApiKeyAuth = (params: CreateApiKeyAuthParams): ApiKeyAuthResult => {
  const apiKeyOptions = params.apiKeyValue ? { value: params.apiKeyValue } : {};
  const apiKey: IApiKey = params.api.addApiKey('ApiKey', apiKeyOptions);
  const usagePlan: UsagePlan = params.api.addUsagePlan('UsagePlan', {
    name: USAGE_PLAN_NAME,
    throttle: createUsagePlanThrottle(),
  });
  usagePlan.addApiKey(apiKey);
  usagePlan.addApiStage({ stage: params.api.deploymentStage });
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

interface CreateAuthConfigParams {
  readonly api: RestApi;
  readonly authType: string;
  readonly apiKeyValue?: string;
}

const createAuthConfig = (params: CreateAuthConfigParams): AuthResult =>
  params.authType === AUTH_TYPE_IAM
    ? createIamAuth()
    : createApiKeyAuth({ api: params.api, apiKeyValue: params.apiKeyValue });

const isApiKeyAuth = (result: AuthResult): result is ApiKeyAuthResult =>
  result.type === AUTH_TYPE_API_KEY;

const isIamAuth = (result: AuthResult): result is IamAuthResult => result.type === AUTH_TYPE_IAM;

export { createAuthConfig, createApiKeyAuth, createIamAuth, isApiKeyAuth, isIamAuth };
export { AUTH_TYPE_API_KEY, AUTH_TYPE_IAM };
export type { AuthConfig, AuthResult, ApiKeyAuthResult, IamAuthResult };
