// Tests for content hashing helper
// Execute with bun: bunx vitest run

import { expect, test } from 'vitest';
import { computeContentHash } from './content-hash.ts';

const HEX_64_REGEX: RegExp = /^[0-9a-f]{64}$/;

// Reference SHA-256 hex digests verified against `printf '%s' '<input>' | shasum -a 256`.

test('computeContentHash returns SHA-256 hex of empty string', async () => {
  const hash: string = await computeContentHash('');
  expect(hash).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('computeContentHash returns SHA-256 hex of "abc"', async () => {
  const hash: string = await computeContentHash('abc');
  expect(hash).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('computeContentHash returns a 64-character lowercase hex string', async () => {
  const hash: string = await computeContentHash('<html>some content</html>');
  expect(hash).toMatch(HEX_64_REGEX);
});

test('computeContentHash is deterministic for the same input', async () => {
  const first: string = await computeContentHash('repeatable-input');
  const second: string = await computeContentHash('repeatable-input');
  expect(first).toBe(second);
});

test('computeContentHash differs for different inputs', async () => {
  const first: string = await computeContentHash('content-one');
  const second: string = await computeContentHash('content-two');
  expect(first).not.toBe(second);
});
