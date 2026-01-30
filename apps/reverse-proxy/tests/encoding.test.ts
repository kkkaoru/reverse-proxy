// Test file for encoding.ts
// Execute with bun: bun run test

import iconv from 'iconv-lite';
import { expect, it } from 'vitest';
import {
  convertResponseToUtf8,
  detectEncodingFromHtmlForTest,
  extractCharsetFromContentTypeForTest,
  isHtmlContentTypeForTest,
  normalizeEncodingNameForTest,
} from '../src/utils/encoding.ts';

const CONTENT_TYPE_HTML_UTF8: string = 'text/html; charset=utf-8';
const CONTENT_TYPE_HTML_EUCJP: string = 'text/html; charset=euc-jp';
const CONTENT_TYPE_HTML_SHIFTJIS: string = 'text/html; charset=shift_jis';
const CONTENT_TYPE_JSON: string = 'application/json';
const CONTENT_TYPE_HTML_PLAIN: string = 'text/html';

it('normalizeEncodingNameForTest normalizes shift_jis variants', () => {
  expect(normalizeEncodingNameForTest('Shift_JIS')).toBe('shift_jis');
  expect(normalizeEncodingNameForTest('shiftjis')).toBe('shift_jis');
  expect(normalizeEncodingNameForTest('SJIS')).toBe('shift_jis');
  expect(normalizeEncodingNameForTest('x-sjis')).toBe('shift_jis');
});

it('normalizeEncodingNameForTest normalizes euc-jp variants', () => {
  expect(normalizeEncodingNameForTest('EUC-JP')).toBe('euc-jp');
  expect(normalizeEncodingNameForTest('eucjp')).toBe('euc-jp');
  expect(normalizeEncodingNameForTest('x-euc-jp')).toBe('euc-jp');
});

it('normalizeEncodingNameForTest normalizes utf-8 variants', () => {
  expect(normalizeEncodingNameForTest('UTF-8')).toBe('utf-8');
  expect(normalizeEncodingNameForTest('utf8')).toBe('utf-8');
});

it('normalizeEncodingNameForTest returns lowercase for unknown encoding', () => {
  expect(normalizeEncodingNameForTest('ISO-8859-15')).toBe('iso-8859-15');
});

it('detectEncodingFromHtmlForTest detects meta charset', () => {
  const html: string = '<html><head><meta charset="euc-jp"></head></html>';
  const result = detectEncodingFromHtmlForTest(html);
  expect(result.encoding).toBe('euc-jp');
  expect(result.confidence).toBe('high');
});

it('detectEncodingFromHtmlForTest detects meta http-equiv content-type', () => {
  const html: string =
    '<html><head><meta http-equiv="Content-Type" content="text/html; charset=shift_jis"></head></html>';
  const result = detectEncodingFromHtmlForTest(html);
  expect(result.encoding).toBe('shift_jis');
  expect(result.confidence).toBe('high');
});

it('detectEncodingFromHtmlForTest detects xml encoding declaration', () => {
  const html: string = '<?xml version="1.0" encoding="EUC-JP"?><html></html>';
  const result = detectEncodingFromHtmlForTest(html);
  expect(result.encoding).toBe('euc-jp');
  expect(result.confidence).toBe('high');
});

it('detectEncodingFromHtmlForTest returns utf-8 as default', () => {
  const html: string = '<html><head></head></html>';
  const result = detectEncodingFromHtmlForTest(html);
  expect(result.encoding).toBe('utf-8');
  expect(result.confidence).toBe('low');
});

it('extractCharsetFromContentTypeForTest extracts charset from content-type', () => {
  expect(extractCharsetFromContentTypeForTest('text/html; charset=utf-8')).toBe('utf-8');
  expect(extractCharsetFromContentTypeForTest('text/html; charset=EUC-JP')).toBe('euc-jp');
  expect(extractCharsetFromContentTypeForTest('text/html; charset="shift_jis"')).toBe('shift_jis');
});

it('extractCharsetFromContentTypeForTest returns null when no charset', () => {
  expect(extractCharsetFromContentTypeForTest('text/html')).toBe(null);
  expect(extractCharsetFromContentTypeForTest('application/json')).toBe(null);
});

it('isHtmlContentTypeForTest returns true for text/html', () => {
  expect(isHtmlContentTypeForTest('text/html')).toBe(true);
  expect(isHtmlContentTypeForTest('text/html; charset=utf-8')).toBe(true);
  expect(isHtmlContentTypeForTest('TEXT/HTML')).toBe(true);
});

it('isHtmlContentTypeForTest returns false for non-html', () => {
  expect(isHtmlContentTypeForTest('application/json')).toBe(false);
  expect(isHtmlContentTypeForTest('text/plain')).toBe(false);
});

it('convertResponseToUtf8 returns original response for non-html content', async () => {
  const response: Response = new Response('{"data":"test"}', {
    headers: { 'content-type': CONTENT_TYPE_JSON },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe(CONTENT_TYPE_JSON);
  expect(await converted.text()).toBe('{"data":"test"}');
});

it('convertResponseToUtf8 returns original response for utf-8 html', async () => {
  const html: string = '<html><head><meta charset="utf-8"></head><body>Test</body></html>';
  const response: Response = new Response(html, {
    headers: { 'content-type': CONTENT_TYPE_HTML_UTF8 },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe(CONTENT_TYPE_HTML_UTF8);
  expect(await converted.text()).toBe(html);
});

it('convertResponseToUtf8 converts euc-jp html to utf-8', async () => {
  const japaneseText: string = 'Japanese text: test';
  const eucjpBytes: Blob = new Blob([new Uint8Array([...iconv.encode(japaneseText, 'euc-jp')])]);
  const response: Response = new Response(eucjpBytes, {
    headers: { 'content-type': CONTENT_TYPE_HTML_EUCJP },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const text: string = await converted.text();
  expect(text).toBe(japaneseText);
});

it('convertResponseToUtf8 converts shift_jis html to utf-8', async () => {
  const japaneseText: string = 'Shift_JIS content: abc';
  const shiftjisBytes: Blob = new Blob([
    new Uint8Array([...iconv.encode(japaneseText, 'shift_jis')]),
  ]);
  const response: Response = new Response(shiftjisBytes, {
    headers: { 'content-type': CONTENT_TYPE_HTML_SHIFTJIS },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const text: string = await converted.text();
  expect(text).toBe(japaneseText);
});

it('convertResponseToUtf8 detects encoding from meta tag when header has no charset', async () => {
  const metaTag: string = '<meta charset="euc-jp">';
  const content: string = `<html><head>${metaTag}</head><body>test content</body></html>`;
  const eucjpBytes: Blob = new Blob([new Uint8Array([...iconv.encode(content, 'euc-jp')])]);
  const response: Response = new Response(eucjpBytes, {
    headers: { 'content-type': CONTENT_TYPE_HTML_PLAIN },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe('text/html; charset=utf-8');
  const text: string = await converted.text();
  expect(text).toBe(content);
});

it('convertResponseToUtf8 returns original for unsupported encoding', async () => {
  const html: string = '<html><head><meta charset="unknown-encoding-xyz"></head></html>';
  const response: Response = new Response(html, {
    headers: { 'content-type': CONTENT_TYPE_HTML_PLAIN },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(await converted.text()).toBe(html);
});

it('convertResponseToUtf8 handles response without content-type header', async () => {
  const html: string = '<html><body>test</body></html>';
  const response: Response = new Response(html);
  const converted: Response = await convertResponseToUtf8(response);
  expect(await converted.text()).toBe(html);
});

it('convertResponseToUtf8 preserves response status and statusText', async () => {
  const japaneseText: string = 'Status test';
  const eucjpBytes: Blob = new Blob([new Uint8Array([...iconv.encode(japaneseText, 'euc-jp')])]);
  const response: Response = new Response(eucjpBytes, {
    status: 201,
    statusText: 'Created',
    headers: { 'content-type': CONTENT_TYPE_HTML_EUCJP },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.status).toBe(201);
  expect(converted.statusText).toBe('Created');
});

it('convertResponseToUtf8 detects encoding from http-equiv meta tag', async () => {
  const metaTag: string = '<meta http-equiv="Content-Type" content="text/html; charset=euc-jp">';
  const content: string = `<html><head>${metaTag}</head><body>test</body></html>`;
  const eucjpBytes: Blob = new Blob([new Uint8Array([...iconv.encode(content, 'euc-jp')])]);
  const response: Response = new Response(eucjpBytes, {
    headers: { 'content-type': CONTENT_TYPE_HTML_PLAIN },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(converted.headers.get('content-type')).toBe('text/html; charset=utf-8');
});

it('convertResponseToUtf8 returns original when html meta says utf-8', async () => {
  const html: string = '<html><head><meta charset="utf-8"></head><body>UTF-8 content</body></html>';
  const response: Response = new Response(html, {
    headers: { 'content-type': CONTENT_TYPE_HTML_PLAIN },
  });
  const converted: Response = await convertResponseToUtf8(response);
  expect(await converted.text()).toBe(html);
});
