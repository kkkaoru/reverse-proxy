#!/usr/bin/env bun
// CDK App entry point for IP Rotate
// Execute with bun: bunx cdk synth

import { App } from 'aws-cdk-lib';
import { filterValidRegions, parseRegionsFromEnv } from '../lib/regions.ts';
import type { IpRotateStackProps } from '../lib/stack.ts';
import { IpRotateStack } from '../lib/stack.ts';

// Interfaces at top
interface TargetDomain {
  readonly protocol: 'http' | 'https';
  readonly host: string;
}

interface ParsedConfig {
  readonly account: string;
  readonly domains: readonly TargetDomain[];
  readonly regions: readonly string[];
  readonly stageName: string;
  readonly authType: string;
  readonly apiKeyValue?: string;
}

interface StackConfig {
  readonly domain: TargetDomain;
  readonly region: string;
  readonly account: string;
  readonly stageName: string;
  readonly authType: string;
  readonly apiKeyValue?: string;
}

interface EnvContextParams {
  readonly app: App;
  readonly envKey: string;
  readonly contextKey: string;
}

interface CreateStacksParams {
  readonly app: App;
  readonly config: ParsedConfig;
}

interface ValidationResult {
  readonly valid: true;
}

interface ValidationError {
  readonly valid: false;
  readonly message: string;
}

type ConfigValidation = ValidationResult | ValidationError;

interface ValidationCheck {
  readonly failed: boolean;
  readonly message: string;
}

// Constants at top
const ENV_CDK_DEFAULT_ACCOUNT = 'CDK_DEFAULT_ACCOUNT';
const ENV_TARGET_DOMAINS = 'TARGET_DOMAINS';
const ENV_REGIONS = 'REGIONS';
const ENV_STAGE_NAME = 'STAGE_NAME';
const ENV_AUTH_TYPE = 'AUTH_TYPE';
const ENV_API_KEY_VALUE = 'API_KEY_VALUE';
const CONTEXT_TARGET_DOMAINS = 'targetDomains';
const CONTEXT_REGIONS = 'regions';
const CONTEXT_STAGE_NAME = 'stageName';
const CONTEXT_AUTH_TYPE = 'authType';
const DEFAULT_STAGE_NAME = 'proxy';
const DEFAULT_AUTH_TYPE = 'api-key';
const PROTOCOL_SEPARATOR = ':';
const DOMAIN_SEPARATOR = ',';
const PROTOCOL_HTTP = 'http';
const PROTOCOL_HTTPS = 'https';
const STACK_ID_PREFIX = 'IpRotate';
const STACK_ID_SEPARATOR = '-';
const HOST_DOT_REPLACEMENT = '-';
const ERROR_MISSING_DOMAINS =
  'Error: TARGET_DOMAINS is required. Format: https:api.example.com,https:data.example.org';
const ERROR_MISSING_REGIONS = 'Error: No valid regions specified.';
const EXIT_CODE_ERROR = 1;
const MIN_DOMAIN_PARTS = 2;

// Pure functions
const parseProtocol = (protocolStr: string): 'http' | 'https' =>
  protocolStr === PROTOCOL_HTTP ? PROTOCOL_HTTP : PROTOCOL_HTTPS;

const parseSingleDomain = (domainStr: string): TargetDomain | null => {
  const parts: readonly string[] = domainStr.split(PROTOCOL_SEPARATOR);
  if (parts.length < MIN_DOMAIN_PARTS) return null;

  const [protocol, ...hostParts] = parts;
  if (!protocol) return null;

  const host: string = hostParts.join(PROTOCOL_SEPARATOR);
  if (!host) return null;

  return {
    protocol: parseProtocol(protocol),
    host: host.trim(),
  };
};

const parseTargetDomains = (domainsStr: string | undefined): readonly TargetDomain[] => {
  if (!domainsStr) return [];

  return domainsStr
    .split(DOMAIN_SEPARATOR)
    .map((s: string): string => s.trim())
    .map(parseSingleDomain)
    .filter((d: TargetDomain | null): d is TargetDomain => d !== null);
};

const sanitizeHostForStackId = (host: string): string =>
  host.replace(/\./g, HOST_DOT_REPLACEMENT).replace(/[^a-zA-Z0-9-]/g, '');

const buildStackId = (host: string, region: string): string =>
  `${STACK_ID_PREFIX}${STACK_ID_SEPARATOR}${sanitizeHostForStackId(host)}${STACK_ID_SEPARATOR}${region}`;

const getEnvOrContext = (params: EnvContextParams): string | undefined =>
  process.env[params.envKey] ?? params.app.node.tryGetContext(params.contextKey);

const parseConfig = (app: App): ParsedConfig => {
  const account: string = process.env[ENV_CDK_DEFAULT_ACCOUNT] ?? '';
  const domainsStr: string | undefined = getEnvOrContext({
    app,
    envKey: ENV_TARGET_DOMAINS,
    contextKey: CONTEXT_TARGET_DOMAINS,
  });
  const regionsStr: string | undefined = getEnvOrContext({
    app,
    envKey: ENV_REGIONS,
    contextKey: CONTEXT_REGIONS,
  });
  const stageName: string =
    getEnvOrContext({ app, envKey: ENV_STAGE_NAME, contextKey: CONTEXT_STAGE_NAME }) ??
    DEFAULT_STAGE_NAME;
  const authType: string =
    getEnvOrContext({ app, envKey: ENV_AUTH_TYPE, contextKey: CONTEXT_AUTH_TYPE }) ??
    DEFAULT_AUTH_TYPE;
  const apiKeyValue: string | undefined = process.env[ENV_API_KEY_VALUE];

  const domains: readonly TargetDomain[] = parseTargetDomains(domainsStr);
  const parsedRegions: readonly string[] = parseRegionsFromEnv(regionsStr);
  const validRegions: readonly string[] = filterValidRegions(parsedRegions);

  return { account, domains, regions: validRegions, stageName, authType, apiKeyValue };
};

const createStackProps = (config: StackConfig): IpRotateStackProps => ({
  targetHost: config.domain.host,
  targetProtocol: config.domain.protocol,
  stageName: config.stageName,
  authType: config.authType,
  apiKeyValue: config.apiKeyValue,
  env: { account: config.account, region: config.region },
});

const createStackForDomainRegion = (app: App, config: StackConfig): IpRotateStack => {
  const stackId: string = buildStackId(config.domain.host, config.region);
  const props: IpRotateStackProps = createStackProps(config);
  return new IpRotateStack(app, stackId, props);
};

const buildStackConfigsForDomain = (
  domain: TargetDomain,
  config: ParsedConfig,
): readonly StackConfig[] =>
  config.regions.map(
    (region: string): StackConfig => ({
      domain,
      region,
      account: config.account,
      stageName: config.stageName,
      authType: config.authType,
      apiKeyValue: config.apiKeyValue,
    }),
  );

const createAllStacks = (params: CreateStacksParams): IpRotateStack[] =>
  params.config.domains
    .flatMap((domain: TargetDomain): readonly StackConfig[] =>
      buildStackConfigsForDomain(domain, params.config),
    )
    .map(
      (stackConfig: StackConfig): IpRotateStack =>
        createStackForDomainRegion(params.app, stackConfig),
    );

const validateChecks = (checks: readonly ValidationCheck[]): ConfigValidation => {
  const error: ValidationCheck | undefined = checks.find(
    (check: ValidationCheck): boolean => check.failed,
  );
  return error ? { valid: false, message: error.message } : { valid: true };
};

const validateConfig = (config: ParsedConfig): ConfigValidation =>
  validateChecks([
    { failed: config.domains.length === 0, message: ERROR_MISSING_DOMAINS },
    { failed: config.regions.length === 0, message: ERROR_MISSING_REGIONS },
  ]);

const handleValidationError = (message: string): never => {
  // biome-ignore lint/suspicious/noConsole: CLI output for user guidance
  console.error(message);
  return process.exit(EXIT_CODE_ERROR);
};

const runCdkApp = (): void => {
  const app: App = new App();
  const config: ParsedConfig = parseConfig(app);
  const validation: ConfigValidation = validateConfig(config);

  if (!validation.valid) {
    handleValidationError(validation.message);
    return;
  }

  createAllStacks({ app, config });
  app.synth();
};

// Export for testing
export {
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
};
export type { ConfigValidation, ParsedConfig, StackConfig, TargetDomain };

// Main execution - only run when not in test environment
// biome-ignore lint/complexity/useLiteralKeys: process.env access
if (process.env['NODE_ENV'] !== 'test') {
  runCdkApp();
}
