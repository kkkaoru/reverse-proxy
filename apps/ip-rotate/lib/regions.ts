// Region configuration for IP Rotate CDK
// Execute with bun: bunx cdk synth

// Interfaces at top
interface RegionConfig {
  readonly defaultRegions: readonly string[];
  readonly allRegions: readonly string[];
}

// Constants at top (not in function scope)
const DEFAULT_REGIONS: readonly string[] = [
  'us-east-1',
  'us-west-2',
  'eu-west-1',
  'ap-northeast-1',
] satisfies readonly string[];

const ALL_REGIONS: readonly string[] = [
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-east-1',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'ca-central-1',
] satisfies readonly string[];

const COMMA_SEPARATOR = ',';

// Pure functions
const createRegionConfig = (): RegionConfig => ({
  defaultRegions: DEFAULT_REGIONS,
  allRegions: ALL_REGIONS,
});

const parseRegionsFromEnv = (envValue: string | undefined): readonly string[] =>
  envValue ? envValue.split(COMMA_SEPARATOR).map((r: string): string => r.trim()) : DEFAULT_REGIONS;

const isValidRegion = (region: string): boolean => ALL_REGIONS.includes(region);

const filterValidRegions = (regions: readonly string[]): readonly string[] =>
  regions.filter(isValidRegion);

export { createRegionConfig, parseRegionsFromEnv, isValidRegion, filterValidRegions };
export { DEFAULT_REGIONS, ALL_REGIONS };
export type { RegionConfig };
