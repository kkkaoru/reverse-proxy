// Tests for domain extraction utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { extractDomain, isValidUrl } from '../../src/utils/domain.ts';

describe('extractDomain', () => {
  it('should extract domain from simple URL', () => {
    const domain: string = extractDomain('https://example.com/path');
    expect(domain).toBe('example.com');
  });

  it('should extract domain from URL with subdomain', () => {
    const domain: string = extractDomain('https://api.example.org/users/profile.html');
    expect(domain).toBe('api.example.org');
  });

  it('should extract domain from URL with port', () => {
    const domain: string = extractDomain('https://localhost:3000/api');
    expect(domain).toBe('localhost');
  });

  it('should extract domain from URL with query params', () => {
    const domain: string = extractDomain('https://example.com?query=value');
    expect(domain).toBe('example.com');
  });

  it('should extract domain from complex URL', () => {
    const domain: string = extractDomain(
      'https://api.example.org/users/profile.html?user_id=12345&tab=settings',
    );
    expect(domain).toBe('api.example.org');
  });

  it('should return empty string for invalid URL', () => {
    const domain: string = extractDomain('not-a-url');
    expect(domain).toBe('');
  });
});

describe('isValidUrl', () => {
  it('should return true for valid HTTPS URL', () => {
    expect(isValidUrl('https://example.com')).toBe(true);
  });

  it('should return true for valid HTTP URL', () => {
    expect(isValidUrl('http://example.com')).toBe(true);
  });

  it('should return true for URL with path', () => {
    expect(isValidUrl('https://example.com/path/to/resource')).toBe(true);
  });

  it('should return true for URL with query params', () => {
    expect(isValidUrl('https://example.com?key=value')).toBe(true);
  });

  it('should return false for invalid URL', () => {
    expect(isValidUrl('not-a-url')).toBe(false);
  });

  it('should return false for empty string', () => {
    expect(isValidUrl('')).toBe(false);
  });

  it('should return false for malformed URL', () => {
    expect(isValidUrl('://missing-protocol.com')).toBe(false);
  });
});
