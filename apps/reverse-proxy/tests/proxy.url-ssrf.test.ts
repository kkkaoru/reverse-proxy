// URL utilities tests
// Execute with bun: wrangler dev

import { describe, expect, test } from 'vitest';
import {
  appendParamIfNeeded,
  buildTargetUrl,
  extractRawParamValue,
  extractRawQuery,
  getQuerySeparator,
  isAllowedProtocol,
  isBlockedHostname,
  isPrivateIp,
  parseTargetUrl,
  urlHasParam,
  validateUrlWithSsrf,
} from '../src/proxy/url.ts';

// parseTargetUrl tests
test('parseTargetUrl returns success for valid URL', () => {
  const result = parseTargetUrl('https://example.com');
  expect(result.success).toStrictEqual(true);
});

test('parseTargetUrl returns URL object for valid URL', () => {
  const result = parseTargetUrl('https://example.com/path');
  expect(result.success).toStrictEqual(true);
  if (result.success) {
    expect(result.value.href).toStrictEqual('https://example.com/path');
  }
});

test('parseTargetUrl returns failure for invalid URL', () => {
  const result = parseTargetUrl('not-a-url');
  expect(result.success).toStrictEqual(false);
});

test('parseTargetUrl returns error message for invalid URL', () => {
  const result = parseTargetUrl('invalid');
  expect(result.success).toStrictEqual(false);
  if (!result.success) {
    expect(result.message).toStrictEqual('Query parameter "url" must be a valid absolute URL.');
  }
});

// extractRawParamValue tests
test('extractRawParamValue returns value for existing param', () => {
  const result = extractRawParamValue('word=test&other=value', 'word');
  expect(result).toStrictEqual('test');
});

test('extractRawParamValue returns undefined for missing param', () => {
  const result = extractRawParamValue('other=value', 'word');
  expect(result).toStrictEqual(undefined);
});

test('extractRawParamValue returns empty string for empty param', () => {
  const result = extractRawParamValue('word=&other=value', 'word');
  expect(result).toStrictEqual('');
});

test('extractRawParamValue handles param at start', () => {
  const result = extractRawParamValue('word=first', 'word');
  expect(result).toStrictEqual('first');
});

// urlHasParam tests
test('urlHasParam returns true when param exists', () => {
  const result = urlHasParam('https://example.com?word=test', 'word');
  expect(result).toStrictEqual(true);
});

test('urlHasParam returns false when param does not exist', () => {
  const result = urlHasParam('https://example.com?other=test', 'word');
  expect(result).toStrictEqual(false);
});

test('urlHasParam returns true for invalid URL', () => {
  const result = urlHasParam('not-a-url', 'word');
  expect(result).toStrictEqual(true);
});

// getQuerySeparator tests
test('getQuerySeparator returns ? for URL without query', () => {
  const result = getQuerySeparator('https://example.com');
  expect(result).toStrictEqual('?');
});

test('getQuerySeparator returns & for URL with query', () => {
  const result = getQuerySeparator('https://example.com?existing=param');
  expect(result).toStrictEqual('&');
});

// appendParamIfNeeded tests
test('appendParamIfNeeded appends param when present in query', () => {
  const result = appendParamIfNeeded('https://example.com', 'word=test', 'word');
  expect(result).toStrictEqual('https://example.com?word=test');
});

test('appendParamIfNeeded does not append when param missing from query', () => {
  const result = appendParamIfNeeded('https://example.com', 'other=test', 'word');
  expect(result).toStrictEqual('https://example.com');
});

test('appendParamIfNeeded does not append when param already in URL', () => {
  const result = appendParamIfNeeded('https://example.com?word=existing', 'word=new', 'word');
  expect(result).toStrictEqual('https://example.com?word=existing');
});

// buildTargetUrl tests
test('buildTargetUrl builds URL with forwarded params', () => {
  const result = buildTargetUrl('https://example.com', 'word=test');
  expect(result).toStrictEqual('https://example.com?word=test');
});

test('buildTargetUrl returns base URL when no matching params', () => {
  const result = buildTargetUrl('https://example.com', 'other=test');
  expect(result).toStrictEqual('https://example.com');
});

// extractRawQuery tests
test('extractRawQuery extracts query string from URL', () => {
  const result = extractRawQuery('https://example.com?word=test&other=value');
  expect(result).toStrictEqual('word=test&other=value');
});

test('extractRawQuery returns empty string for URL without query', () => {
  const result = extractRawQuery('https://example.com');
  expect(result).toStrictEqual('');
});

// isAllowedProtocol tests
test('isAllowedProtocol returns true for http', () => {
  expect(isAllowedProtocol(new URL('http://example.com'))).toStrictEqual(true);
});

test('isAllowedProtocol returns true for https', () => {
  expect(isAllowedProtocol(new URL('https://example.com'))).toStrictEqual(true);
});

test('isAllowedProtocol returns false for ftp', () => {
  expect(isAllowedProtocol(new URL('ftp://example.com'))).toStrictEqual(false);
});

test('isAllowedProtocol returns false for file', () => {
  expect(isAllowedProtocol(new URL('file:///etc/passwd'))).toStrictEqual(false);
});

test('isAllowedProtocol returns false for javascript', () => {
  expect(isAllowedProtocol(new URL('javascript:alert(1)'))).toStrictEqual(false);
});

// isBlockedHostname tests
test('isBlockedHostname returns true for localhost', () => {
  expect(isBlockedHostname('localhost')).toStrictEqual(true);
});

test('isBlockedHostname returns true for 127.0.0.1', () => {
  expect(isBlockedHostname('127.0.0.1')).toStrictEqual(true);
});

test('isBlockedHostname returns true for 0.0.0.0', () => {
  expect(isBlockedHostname('0.0.0.0')).toStrictEqual(true);
});

test('isBlockedHostname returns true for [::1]', () => {
  expect(isBlockedHostname('[::1]')).toStrictEqual(true);
});

test('isBlockedHostname returns true for [::]', () => {
  expect(isBlockedHostname('[::]')).toStrictEqual(true);
});

test('isBlockedHostname returns true for LOCALHOST uppercase', () => {
  expect(isBlockedHostname('LOCALHOST')).toStrictEqual(true);
});

test('isBlockedHostname returns false for example.com', () => {
  expect(isBlockedHostname('example.com')).toStrictEqual(false);
});

test('isBlockedHostname returns false for public IP', () => {
  expect(isBlockedHostname('8.8.8.8')).toStrictEqual(false);
});

// isPrivateIp tests
test('isPrivateIp returns true for 10.0.0.1', () => {
  expect(isPrivateIp('10.0.0.1')).toStrictEqual(true);
});

test('isPrivateIp returns true for 10.255.255.255', () => {
  expect(isPrivateIp('10.255.255.255')).toStrictEqual(true);
});

test('isPrivateIp returns true for 172.16.0.1', () => {
  expect(isPrivateIp('172.16.0.1')).toStrictEqual(true);
});

test('isPrivateIp returns true for 172.31.255.255', () => {
  expect(isPrivateIp('172.31.255.255')).toStrictEqual(true);
});

test('isPrivateIp returns false for 172.15.0.1', () => {
  expect(isPrivateIp('172.15.0.1')).toStrictEqual(false);
});

test('isPrivateIp returns false for 172.32.0.1', () => {
  expect(isPrivateIp('172.32.0.1')).toStrictEqual(false);
});

test('isPrivateIp returns true for 192.168.0.1', () => {
  expect(isPrivateIp('192.168.0.1')).toStrictEqual(true);
});

test('isPrivateIp returns true for 192.168.255.255', () => {
  expect(isPrivateIp('192.168.255.255')).toStrictEqual(true);
});

test('isPrivateIp returns true for 169.254.0.1', () => {
  expect(isPrivateIp('169.254.0.1')).toStrictEqual(true);
});

test('isPrivateIp returns true for fc00::', () => {
  expect(isPrivateIp('fc00::')).toStrictEqual(true);
});

test('isPrivateIp returns true for fd00::', () => {
  expect(isPrivateIp('fd00::')).toStrictEqual(true);
});

test('isPrivateIp returns true for fe80::', () => {
  expect(isPrivateIp('fe80::')).toStrictEqual(true);
});

test('isPrivateIp returns false for 8.8.8.8', () => {
  expect(isPrivateIp('8.8.8.8')).toStrictEqual(false);
});

test('isPrivateIp returns false for example.com', () => {
  expect(isPrivateIp('example.com')).toStrictEqual(false);
});

// validateUrlWithSsrf tests
test('validateUrlWithSsrf returns success for valid public URL', () => {
  const result = validateUrlWithSsrf('https://example.com');
  expect(result.valid).toStrictEqual(true);
});

test('validateUrlWithSsrf returns URL object for valid URL', () => {
  const result = validateUrlWithSsrf('https://example.com/path');
  expect(result.valid).toStrictEqual(true);
  if (result.valid) {
    expect(result.url.href).toStrictEqual('https://example.com/path');
  }
});

test('validateUrlWithSsrf returns failure for invalid URL', () => {
  const result = validateUrlWithSsrf('not-a-url');
  expect(result.valid).toStrictEqual(false);
});

test('validateUrlWithSsrf returns failure for ftp protocol', () => {
  const result = validateUrlWithSsrf('ftp://example.com');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Only http and https protocols are allowed');
  }
});

test('validateUrlWithSsrf returns failure for localhost', () => {
  const result = validateUrlWithSsrf('https://localhost/admin');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Access to this host is not allowed');
  }
});

test('validateUrlWithSsrf returns failure for 127.0.0.1', () => {
  const result = validateUrlWithSsrf('https://127.0.0.1/secret');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Access to this host is not allowed');
  }
});

test('validateUrlWithSsrf returns failure for private IP 10.0.0.1', () => {
  const result = validateUrlWithSsrf('https://10.0.0.1/internal');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Access to private IP addresses is not allowed');
  }
});

test('validateUrlWithSsrf returns failure for private IP 192.168.1.1', () => {
  const result = validateUrlWithSsrf('https://192.168.1.1/router');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Access to private IP addresses is not allowed');
  }
});

test('validateUrlWithSsrf returns failure for private IP 172.16.0.1', () => {
  const result = validateUrlWithSsrf('https://172.16.0.1/internal');
  expect(result.valid).toStrictEqual(false);
  if (!result.valid) {
    expect(result.reason).toStrictEqual('Access to private IP addresses is not allowed');
  }
});

test('validateUrlWithSsrf returns success for http protocol', () => {
  const result = validateUrlWithSsrf('http://example.com');
  expect(result.valid).toStrictEqual(true);
});

test('validateUrlWithSsrf returns success for public IP', () => {
  const result = validateUrlWithSsrf('https://8.8.8.8');
  expect(result.valid).toStrictEqual(true);
});

describe('validateUrlWithSsrf edge cases', () => {
  test('returns failure for [::1] IPv6 localhost', () => {
    const result = validateUrlWithSsrf('https://[::1]/admin');
    expect(result.valid).toStrictEqual(false);
  });

  test('returns failure for link-local IPv6', () => {
    const result = validateUrlWithSsrf('https://[fe80::1]/local');
    expect(result.valid).toStrictEqual(false);
    if (!result.valid) {
      expect(result.reason).toStrictEqual('Access to private IP addresses is not allowed');
    }
  });
});
