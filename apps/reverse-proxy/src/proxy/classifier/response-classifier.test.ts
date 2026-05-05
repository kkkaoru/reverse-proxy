// Run with: bun run test
import { describe, expect, it } from 'vitest';
import { classifyResponse } from './response-classifier.ts';

const buildResponse = (body: string, status: number): Response =>
  new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8' },
  });

describe('classifyResponse', () => {
  it('returns null for a healthy 200 response with non-empty body', async () => {
    const response = buildResponse('<html><body>ok</body></html>', 200);
    expect(await classifyResponse({ response })).toBe(null);
  });

  it('returns transient-upstream for 502', async () => {
    const response = buildResponse('error', 502);
    expect(await classifyResponse({ response })).toBe('transient-upstream');
  });

  it('returns transient-upstream for 408', async () => {
    const response = buildResponse('timeout', 408);
    expect(await classifyResponse({ response })).toBe('transient-upstream');
  });

  it('returns transient-upstream for 429', async () => {
    const response = buildResponse('rate limited', 429);
    expect(await classifyResponse({ response })).toBe('transient-upstream');
  });

  it('returns transient-upstream for 400 (AWS API Gateway burst)', async () => {
    const response = buildResponse('bad request', 400);
    expect(await classifyResponse({ response })).toBe('transient-upstream');
  });

  it('returns client-error for 404', async () => {
    const response = buildResponse('not found', 404);
    expect(await classifyResponse({ response })).toBe('client-error');
  });

  it('returns client-error for 401', async () => {
    const response = buildResponse('unauthorized', 401);
    expect(await classifyResponse({ response })).toBe('client-error');
  });

  it('returns bot-protection for Akamai TITLE marker on 200', async () => {
    const response = buildResponse('<html><head><TITLE>Access Denied</TITLE></head></html>', 200);
    expect(await classifyResponse({ response })).toBe('bot-protection');
  });

  it('returns bot-protection for Akamai header marker on 200', async () => {
    const response = buildResponse('<h1>Access Denied</h1>', 200);
    expect(await classifyResponse({ response })).toBe('bot-protection');
  });

  it('returns payload-corrupted for empty body on 200', async () => {
    const response = buildResponse('', 200);
    expect(await classifyResponse({ response })).toBe('payload-corrupted');
  });

  it('returns payload-corrupted for mojibake-heavy body', async () => {
    const response = buildResponse('hello ����� world', 200);
    expect(await classifyResponse({ response })).toBe('payload-corrupted');
  });

  it('does not mistake 4xx with Akamai-shaped body for bot-protection', async () => {
    // 4xx rule runs first so a 404 page that happens to contain
    // "Access Denied" copy is still classified as a terminal client
    // error rather than as bot-protection.
    const response = buildResponse('<TITLE>Access Denied</TITLE>', 404);
    expect(await classifyResponse({ response })).toBe('client-error');
  });
});
