// Error utilities tests

import { describe, expect, it } from 'vitest';
import { getErrorMessage } from '../src/proxy/errors.ts';

describe('getErrorMessage', () => {
  it('should extract message from Error instance', () => {
    const error = new Error('Test error message');
    expect(getErrorMessage(error)).toBe('Test error message');
  });

  it('should return default message for non-Error objects', () => {
    expect(getErrorMessage('string error')).toBe('Unknown fetch error');
    expect(getErrorMessage({ message: 'object error' })).toBe('Unknown fetch error');
    expect(getErrorMessage(null)).toBe('Unknown fetch error');
    expect(getErrorMessage(undefined)).toBe('Unknown fetch error');
    expect(getErrorMessage(123)).toBe('Unknown fetch error');
  });
});
