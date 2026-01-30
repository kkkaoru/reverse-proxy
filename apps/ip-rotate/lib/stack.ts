// IP Rotate Stack - API Gateway HTTP Proxy
// Execute with bun: bunx cdk synth

import type { StackProps } from 'aws-cdk-lib';
import { CfnOutput, Stack } from 'aws-cdk-lib';
import type { MethodOptions } from 'aws-cdk-lib/aws-apigateway';
import { EndpointType, HttpIntegration, RestApi } from 'aws-cdk-lib/aws-apigateway';
import type { Construct } from 'constructs';
import type { AuthResult } from './auth.ts';
import { createAuthConfig, isApiKeyAuth } from './auth.ts';

// Interfaces at top
interface IpRotateStackProps extends StackProps {
  readonly targetHost: string;
  readonly targetProtocol: 'http' | 'https';
  readonly stageName: string;
  readonly authType: string;
}

interface ApiResources {
  readonly api: RestApi;
  readonly endpoint: string;
  readonly apiId: string;
  readonly authResult: AuthResult;
}

interface CreateIntegrationParams {
  readonly targetProtocol: string;
  readonly targetHost: string;
}

interface StackOutputs {
  readonly endpoint: string;
  readonly apiId: string;
  readonly apiKeyId?: string;
}

// Constants at top
const API_NAME_PREFIX = 'IpRotateProxy';
const PROXY_RESOURCE_PATH = '{proxy+}';
const HTTP_METHOD_ANY = 'ANY';
const REQUEST_PARAM_PROXY = 'method.request.path.proxy';
const INTEGRATION_PARAM_PROXY = 'integration.request.path.proxy';
const OUTPUT_API_ENDPOINT = 'ApiEndpoint';
const OUTPUT_API_ID = 'ApiId';
const OUTPUT_API_KEY_ID = 'ApiKeyId';

// Pure functions (guard pattern for early returns)
const buildProxyIntegrationUrl = (params: CreateIntegrationParams): string =>
  `${params.targetProtocol}://${params.targetHost}/{proxy}`;

const buildRootIntegrationUrl = (params: CreateIntegrationParams): string =>
  `${params.targetProtocol}://${params.targetHost}/`;

const createProxyIntegration = (params: CreateIntegrationParams): HttpIntegration =>
  new HttpIntegration(buildProxyIntegrationUrl(params), {
    httpMethod: HTTP_METHOD_ANY,
    proxy: true,
    options: {
      requestParameters: {
        [INTEGRATION_PARAM_PROXY]: REQUEST_PARAM_PROXY,
      },
    },
  });

const createRootIntegration = (params: CreateIntegrationParams): HttpIntegration =>
  new HttpIntegration(buildRootIntegrationUrl(params), {
    httpMethod: HTTP_METHOD_ANY,
    proxy: true,
  });

const buildApiName = (region: string): string => `${API_NAME_PREFIX}-${region}`;

// Stack class
class IpRotateStack extends Stack {
  public readonly apiEndpoint: string;
  public readonly apiId: string;
  public readonly apiKeyId: string | undefined;

  constructor(scope: Construct, id: string, props: IpRotateStackProps) {
    super(scope, id, props);
    const resources: ApiResources = this.createApiResources(props);
    this.apiEndpoint = resources.endpoint;
    this.apiId = resources.apiId;
    this.apiKeyId = isApiKeyAuth(resources.authResult)
      ? resources.authResult.apiKey.keyId
      : undefined;
    this.createOutputs({
      endpoint: resources.endpoint,
      apiId: resources.apiId,
      apiKeyId: this.apiKeyId,
    });
  }

  private createApiResources(props: IpRotateStackProps): ApiResources {
    const api: RestApi = new RestApi(this, 'ProxyApi', {
      restApiName: buildApiName(this.region),
      endpointConfiguration: { types: [EndpointType.REGIONAL] },
      deployOptions: { stageName: props.stageName },
    });

    const authResult: AuthResult = createAuthConfig(api, props.authType);
    const methodOptions: MethodOptions = authResult.methodOptions;

    const integrationParams: CreateIntegrationParams = {
      targetProtocol: props.targetProtocol,
      targetHost: props.targetHost,
    };

    const proxyResource = api.root.addResource(PROXY_RESOURCE_PATH);
    proxyResource.addMethod(HTTP_METHOD_ANY, createProxyIntegration(integrationParams), {
      ...methodOptions,
      requestParameters: { [REQUEST_PARAM_PROXY]: true },
    });
    api.root.addMethod(HTTP_METHOD_ANY, createRootIntegration(integrationParams), methodOptions);

    return {
      api,
      endpoint: api.url,
      apiId: api.restApiId,
      authResult,
    };
  }

  private createOutputs(outputs: StackOutputs): void {
    new CfnOutput(this, OUTPUT_API_ENDPOINT, { value: outputs.endpoint });
    new CfnOutput(this, OUTPUT_API_ID, { value: outputs.apiId });
    if (outputs.apiKeyId) {
      new CfnOutput(this, OUTPUT_API_KEY_ID, { value: outputs.apiKeyId });
    }
  }
}

export { IpRotateStack };
export type { IpRotateStackProps };
