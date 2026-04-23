// Tests for Akamai block detection
// Execute with bun: bun run test

import { describe, expect, test } from 'vitest';
import {
  AKAMAI_BLOCK_PREVIEW_BYTES,
  isAkamaiBlockBody,
  isAkamaiBlockedResponse,
  readBodyPreview,
  STATUS_FORBIDDEN,
} from './akamai.ts';

const BLOCK_HTML_UPPER: string =
  '<HTML><HEAD><TITLE>Access Denied</TITLE></HEAD><BODY>blocked</BODY></HTML>';
const BLOCK_HTML_LOWER: string =
  '<html><head><title>access denied</title></head><body>blocked</body></html>';
const BLOCK_HTML_HEADER: string =
  '<html><body><h1>Access Denied</h1>You do not have permission</body></html>';
const BLOCK_HTML_REFERENCE: string =
  '<html><body>Reference #18.abc.errors.edgesuite.net/ref</body></html>';
const SAFE_HTML: string =
  '<!DOCTYPE html><html><body><h1>Welcome</h1><table></table></body></html>';

describe('isAkamaiBlockBody', () => {
  test('detects uppercase TITLE marker', () => {
    expect(isAkamaiBlockBody(BLOCK_HTML_UPPER)).toBe(true);
  });

  test('detects lowercase title marker', () => {
    expect(isAkamaiBlockBody(BLOCK_HTML_LOWER)).toBe(true);
  });

  test('detects H1 Access Denied marker', () => {
    expect(isAkamaiBlockBody(BLOCK_HTML_HEADER)).toBe(true);
  });

  test('detects edgesuite reference marker', () => {
    expect(isAkamaiBlockBody(BLOCK_HTML_REFERENCE)).toBe(true);
  });

  test('returns false for empty string', () => {
    expect(isAkamaiBlockBody('')).toBe(false);
  });

  test('returns false for normal HTML', () => {
    expect(isAkamaiBlockBody(SAFE_HTML)).toBe(false);
  });
});

describe('readBodyPreview', () => {
  test('returns first N bytes of response body', async () => {
    const response: Response = new Response(SAFE_HTML);
    const preview: string = await readBodyPreview(response);
    expect(preview.length).toBeLessThanOrEqual(AKAMAI_BLOCK_PREVIEW_BYTES);
    expect(preview).toBe(SAFE_HTML);
  });

  test('does not consume original response body (clone semantics)', async () => {
    const response: Response = new Response(SAFE_HTML);
    await readBodyPreview(response);
    const original: string = await response.text();
    expect(original).toBe(SAFE_HTML);
  });

  test('returns empty string on body read failure', async () => {
    const response: Response = new Response(null);
    await response.text();
    const preview: string = await readBodyPreview(response);
    expect(preview).toBe('');
  });
});

describe('isAkamaiBlockedResponse', () => {
  test('returns true for 403 status regardless of body', async () => {
    const response: Response = new Response('whatever', { status: STATUS_FORBIDDEN });
    expect(await isAkamaiBlockedResponse(response)).toBe(true);
  });

  test('returns true for 200 with Akamai HTML body (uppercase)', async () => {
    const response: Response = new Response(BLOCK_HTML_UPPER, { status: 200 });
    expect(await isAkamaiBlockedResponse(response)).toBe(true);
  });

  test('returns true for 200 with Akamai HTML body (lowercase)', async () => {
    const response: Response = new Response(BLOCK_HTML_LOWER, { status: 200 });
    expect(await isAkamaiBlockedResponse(response)).toBe(true);
  });

  test('returns false for 200 with normal HTML body', async () => {
    const response: Response = new Response(SAFE_HTML, { status: 200 });
    expect(await isAkamaiBlockedResponse(response)).toBe(false);
  });

  test('returns false for 500 with normal body', async () => {
    const response: Response = new Response(SAFE_HTML, { status: 500 });
    expect(await isAkamaiBlockedResponse(response)).toBe(false);
  });
});
