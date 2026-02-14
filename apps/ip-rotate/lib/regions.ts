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
  // US
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  // Africa
  'af-south-1',
  // Asia Pacific
  'ap-east-1',
  'ap-east-2',
  'ap-south-1',
  'ap-south-2',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-northeast-3',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-southeast-3',
  'ap-southeast-4',
  'ap-southeast-5',
  'ap-southeast-6',
  'ap-southeast-7',
  // Canada
  'ca-central-1',
  'ca-west-1',
  // Europe
  'eu-central-1',
  'eu-central-2',
  'eu-south-1',
  'eu-south-2',
  'eu-west-1',
  'eu-west-2',
  'eu-west-3',
  'eu-north-1',
  // Mexico
  'mx-central-1',
  // Middle East
  'me-central-1',
  'me-south-1',
  // South America
  'sa-east-1',
  // Israel
  'il-central-1',
] satisfies readonly string[];

const COMMA_SEPARATOR = ',';
const REGIONS_ALL_KEYWORD = 'ALL';

// Pure functions
const createRegionConfig = (): RegionConfig => ({
  defaultRegions: DEFAULT_REGIONS,
  allRegions: ALL_REGIONS,
});

const isAllRegionsKeyword = (value: string): boolean =>
  value.trim().toUpperCase() === REGIONS_ALL_KEYWORD;

const parseRegionsFromEnv = (envValue: string | undefined): readonly string[] => {
  if (!envValue) return DEFAULT_REGIONS;
  if (isAllRegionsKeyword(envValue)) return ALL_REGIONS;
  return envValue.split(COMMA_SEPARATOR).map((r: string): string => r.trim());
};

const isValidRegion = (region: string): boolean => ALL_REGIONS.includes(region);

const filterValidRegions = (regions: readonly string[]): readonly string[] =>
  regions.filter(isValidRegion);

export {
  createRegionConfig,
  isAllRegionsKeyword,
  parseRegionsFromEnv,
  isValidRegion,
  filterValidRegions,
};
export { DEFAULT_REGIONS, ALL_REGIONS, REGIONS_ALL_KEYWORD };
export type { RegionConfig };
