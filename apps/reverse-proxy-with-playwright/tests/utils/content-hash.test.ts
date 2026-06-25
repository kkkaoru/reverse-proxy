// Tests for content hashing utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { computeContentHash } from '../../src/utils/content-hash.ts';

const HEX_64_REGEX = /^[0-9a-f]{64}$/;

describe('computeContentHash', () => {
  it('returns the known SHA-256 hex digest for an empty string', async () => {
    const result = await computeContentHash('');
    expect(result).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('returns the known SHA-256 hex digest for "abc"', async () => {
    const result = await computeContentHash('abc');
    expect(result).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('produces a 64-character lowercase hex string', async () => {
    const result = await computeContentHash('<html><body>Some content</body></html>');
    expect(result).toMatch(HEX_64_REGEX);
  });

  it('returns identical hashes for identical input', async () => {
    const first = await computeContentHash('<html>same</html>');
    const second = await computeContentHash('<html>same</html>');
    expect(first).toBe(second);
  });

  it('returns different hashes for different input', async () => {
    const first = await computeContentHash('<html>one</html>');
    const second = await computeContentHash('<html>two</html>');
    expect(first).not.toBe(second);
  });

  it('hashes multibyte utf-8 content consistently', async () => {
    const first = await computeContentHash('<div>会員登録</div>');
    const second = await computeContentHash('<div>会員登録</div>');
    expect(first).toBe(second);
    expect(first).toMatch(HEX_64_REGEX);
  });
});
