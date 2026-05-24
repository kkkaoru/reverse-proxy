// Tests for Akamai block page detection
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { isAkamaiBlockBody } from '../../src/utils/akamai.ts';

describe('isAkamaiBlockBody', () => {
  it('detects Access Denied title', () => {
    expect(isAkamaiBlockBody('<html><head><TITLE>Access Denied</TITLE></head></html>')).toBe(true);
  });

  it('detects lowercase Access Denied title', () => {
    expect(isAkamaiBlockBody('<html><head><title>access denied</title></head></html>')).toBe(true);
  });

  it('detects edge suite reference marker', () => {
    expect(
      isAkamaiBlockBody('<html><body>Reference #18.abc.errors.edgesuite.net</body></html>'),
    ).toBe(true);
  });

  it('does not reject normal html', () => {
    expect(isAkamaiBlockBody('<html><body>Signed in page</body></html>')).toBe(false);
  });
});
