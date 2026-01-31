// URL utilities tests

import { describe, expect, it } from 'vitest';
import {
  appendParamIfNeeded,
  buildTargetUrl,
  extractRawParamValue,
  extractRawQuery,
  FORWARD_PARAMS,
  getQuerySeparator,
  parseTargetUrl,
  QUERY_SEPARATOR_APPEND,
  QUERY_SEPARATOR_INITIAL,
  urlHasParam,
} from '../src/proxy/url.ts';

describe('parseTargetUrl', () => {
  it('should parse valid URL', () => {
    const result = parseTargetUrl('https://example.com/path');
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value.href).toBe('https://example.com/path');
    }
  });

  it('should return error for invalid URL', () => {
    const result = parseTargetUrl('not-a-valid-url');
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.message).toBe('Query parameter "url" must be a valid absolute URL.');
    }
  });
});

describe('extractRawParamValue', () => {
  it('should extract parameter value from query string', () => {
    expect(extractRawParamValue('word=hello&other=world', 'word')).toBe('hello');
    expect(extractRawParamValue('other=world&word=hello', 'word')).toBe('hello');
  });

  it('should return undefined for missing parameter', () => {
    expect(extractRawParamValue('other=world', 'word')).toBeUndefined();
  });

  it('should handle empty value', () => {
    expect(extractRawParamValue('word=&other=value', 'word')).toBe('');
  });

  it('should be case insensitive', () => {
    expect(extractRawParamValue('WORD=hello', 'word')).toBe('hello');
  });
});

describe('urlHasParam', () => {
  it('should return true if URL has parameter', () => {
    expect(urlHasParam('https://example.com?word=hello', 'word')).toBe(true);
  });

  it('should return false if URL does not have parameter', () => {
    expect(urlHasParam('https://example.com?other=value', 'word')).toBe(false);
  });

  it('should return false for URL without query string', () => {
    expect(urlHasParam('https://example.com/path', 'word')).toBe(false);
  });

  it('should return true for invalid URL (defensive)', () => {
    expect(urlHasParam('invalid-url', 'word')).toBe(true);
  });
});

describe('getQuerySeparator', () => {
  it('should return ? for URL without query string', () => {
    expect(getQuerySeparator('https://example.com/path')).toBe(QUERY_SEPARATOR_INITIAL);
  });

  it('should return & for URL with existing query string', () => {
    expect(getQuerySeparator('https://example.com?existing=value')).toBe(QUERY_SEPARATOR_APPEND);
  });
});

describe('appendParamIfNeeded', () => {
  it('should append parameter if not present', () => {
    const result = appendParamIfNeeded('https://example.com', 'word=hello', 'word');
    expect(result).toBe('https://example.com?word=hello');
  });

  it('should not append if parameter already in URL', () => {
    const result = appendParamIfNeeded('https://example.com?word=existing', 'word=hello', 'word');
    expect(result).toBe('https://example.com?word=existing');
  });

  it('should not append if parameter not in raw query', () => {
    const result = appendParamIfNeeded('https://example.com', 'other=value', 'word');
    expect(result).toBe('https://example.com');
  });

  it('should use & separator for URL with existing query', () => {
    const result = appendParamIfNeeded('https://example.com?existing=value', 'word=hello', 'word');
    expect(result).toBe('https://example.com?existing=value&word=hello');
  });
});

describe('buildTargetUrl', () => {
  it('should forward word parameter', () => {
    expect(FORWARD_PARAMS).toContain('word');
    const result = buildTargetUrl('https://example.com', 'word=hello');
    expect(result).toBe('https://example.com?word=hello');
  });

  it('should not modify URL if no forward params present', () => {
    const result = buildTargetUrl('https://example.com', 'other=value');
    expect(result).toBe('https://example.com');
  });
});

describe('extractRawQuery', () => {
  it('should extract query string without leading ?', () => {
    expect(extractRawQuery('https://example.com?word=hello&other=value')).toBe(
      'word=hello&other=value',
    );
  });

  it('should return empty string for URL without query', () => {
    expect(extractRawQuery('https://example.com/path')).toBe('');
  });
});
