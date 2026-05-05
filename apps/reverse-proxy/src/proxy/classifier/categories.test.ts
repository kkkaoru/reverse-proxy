// Run with: bun run test
import { describe, expect, it } from 'vitest';
import { routeForCategory } from './categories.ts';

describe('routeForCategory', () => {
  it('routes transient-upstream to IP rotate', () => {
    expect(routeForCategory('transient-upstream')).toBe('prefer-ip-rotate');
  });

  it('routes bot-protection to browser', () => {
    expect(routeForCategory('bot-protection')).toBe('prefer-browser');
  });

  it('routes payload-corrupted to IP rotate', () => {
    expect(routeForCategory('payload-corrupted')).toBe('prefer-ip-rotate');
  });

  it('routes client-error to fail', () => {
    expect(routeForCategory('client-error')).toBe('fail');
  });

  it('routes null (no failure) to pass-through', () => {
    expect(routeForCategory(null)).toBe('pass-through');
  });
});
