// Region configuration tests
// Execute with bun: bun test

import { describe, expect, test } from 'vitest';
import {
  ALL_REGIONS,
  createRegionConfig,
  DEFAULT_REGIONS,
  filterValidRegions,
  isValidRegion,
  parseRegionsFromEnv,
} from './regions.ts';

describe('regions', () => {
  describe('DEFAULT_REGIONS', () => {
    test('should have 4 default regions', () => {
      expect(DEFAULT_REGIONS.length).toBe(4);
    });

    test('should include us-east-1', () => {
      expect(DEFAULT_REGIONS[0]).toBe('us-east-1');
    });

    test('should include us-west-2', () => {
      expect(DEFAULT_REGIONS[1]).toBe('us-west-2');
    });

    test('should include eu-west-1', () => {
      expect(DEFAULT_REGIONS[2]).toBe('eu-west-1');
    });

    test('should include ap-northeast-1', () => {
      expect(DEFAULT_REGIONS[3]).toBe('ap-northeast-1');
    });
  });

  describe('ALL_REGIONS', () => {
    test('should have 15 regions', () => {
      expect(ALL_REGIONS.length).toBe(15);
    });

    test('should include us-east-1', () => {
      expect(ALL_REGIONS[0]).toBe('us-east-1');
    });

    test('should include sa-east-1', () => {
      expect(ALL_REGIONS[13]).toBe('sa-east-1');
    });
  });

  describe('createRegionConfig', () => {
    test('should return config with default regions', () => {
      const config = createRegionConfig();
      expect(config.defaultRegions).toStrictEqual(DEFAULT_REGIONS);
    });

    test('should return config with all regions', () => {
      const config = createRegionConfig();
      expect(config.allRegions).toStrictEqual(ALL_REGIONS);
    });
  });

  describe('parseRegionsFromEnv', () => {
    test('should return default regions when envValue is undefined', () => {
      const result = parseRegionsFromEnv(undefined);
      expect(result).toStrictEqual(DEFAULT_REGIONS);
    });

    test('should return default regions when envValue is empty string', () => {
      const result = parseRegionsFromEnv('');
      expect(result).toStrictEqual(DEFAULT_REGIONS);
    });

    test('should parse single region', () => {
      const result = parseRegionsFromEnv('us-east-1');
      expect(result).toStrictEqual(['us-east-1']);
    });

    test('should parse multiple regions separated by comma', () => {
      const result = parseRegionsFromEnv('us-east-1,eu-west-1');
      expect(result).toStrictEqual(['us-east-1', 'eu-west-1']);
    });

    test('should trim whitespace from regions', () => {
      const result = parseRegionsFromEnv('us-east-1 , eu-west-1 ');
      expect(result).toStrictEqual(['us-east-1', 'eu-west-1']);
    });

    test('should parse three regions', () => {
      const result = parseRegionsFromEnv('us-east-1,us-west-2,ap-northeast-1');
      expect(result).toStrictEqual(['us-east-1', 'us-west-2', 'ap-northeast-1']);
    });
  });

  describe('isValidRegion', () => {
    test('should return true for us-east-1', () => {
      expect(isValidRegion('us-east-1')).toBe(true);
    });

    test('should return true for ap-northeast-1', () => {
      expect(isValidRegion('ap-northeast-1')).toBe(true);
    });

    test('should return false for invalid-region', () => {
      expect(isValidRegion('invalid-region')).toBe(false);
    });

    test('should return false for empty string', () => {
      expect(isValidRegion('')).toBe(false);
    });

    test('should return false for us-east-99', () => {
      expect(isValidRegion('us-east-99')).toBe(false);
    });
  });

  describe('filterValidRegions', () => {
    test('should return empty array when input is empty', () => {
      const result = filterValidRegions([]);
      expect(result).toStrictEqual([]);
    });

    test('should filter out invalid regions', () => {
      const result = filterValidRegions(['us-east-1', 'invalid', 'eu-west-1']);
      expect(result).toStrictEqual(['us-east-1', 'eu-west-1']);
    });

    test('should return all valid regions', () => {
      const result = filterValidRegions(['us-east-1', 'us-west-2']);
      expect(result).toStrictEqual(['us-east-1', 'us-west-2']);
    });

    test('should return empty array when all regions are invalid', () => {
      const result = filterValidRegions(['invalid1', 'invalid2']);
      expect(result).toStrictEqual([]);
    });
  });
});
