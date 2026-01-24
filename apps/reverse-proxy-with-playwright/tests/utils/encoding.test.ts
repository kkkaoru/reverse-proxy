// Tests for HTML encoding detection and conversion utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  convertToUtf8,
  detectEncoding,
  detectEncodingFromHtmlForTest,
  normalizeEncodingNameForTest,
} from '../../src/utils/encoding.ts';

describe('detectEncodingFromHtml', () => {
  it('should detect UTF-8 from meta charset', () => {
    const html = '<html><head><meta charset="UTF-8"></head></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBe('high');
  });

  it('should detect Shift_JIS from meta charset', () => {
    const html = '<html><head><meta charset="Shift_JIS"></head></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('shift_jis');
    expect(result.confidence).toBe('high');
  });

  it('should detect EUC-JP from meta charset', () => {
    const html = '<html><head><meta charset="EUC-JP"></head></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('euc-jp');
    expect(result.confidence).toBe('high');
  });

  it('should detect encoding from Content-Type meta tag', () => {
    const html =
      '<html><head><meta http-equiv="Content-Type" content="text/html; charset=Shift_JIS"></head></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('shift_jis');
    expect(result.confidence).toBe('high');
  });

  it('should detect encoding from XML declaration', () => {
    const html = '<?xml version="1.0" encoding="EUC-JP"?><html></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('euc-jp');
    expect(result.confidence).toBe('high');
  });

  it('should return UTF-8 with low confidence when no encoding is specified', () => {
    const html = '<html><head><title>Test</title></head></html>';
    const result = detectEncodingFromHtmlForTest(html);
    expect(result.encoding).toBe('utf-8');
    expect(result.confidence).toBe('low');
  });
});

describe('normalizeEncodingName', () => {
  it('should normalize shift_jis variants', () => {
    expect(normalizeEncodingNameForTest('Shift_JIS')).toBe('shift_jis');
    expect(normalizeEncodingNameForTest('SJIS')).toBe('shift_jis');
    expect(normalizeEncodingNameForTest('x-sjis')).toBe('shift_jis');
  });

  it('should normalize euc-jp variants', () => {
    expect(normalizeEncodingNameForTest('EUC-JP')).toBe('euc-jp');
    expect(normalizeEncodingNameForTest('x-euc-jp')).toBe('euc-jp');
  });

  it('should normalize utf-8 variants', () => {
    expect(normalizeEncodingNameForTest('UTF-8')).toBe('utf-8');
    expect(normalizeEncodingNameForTest('utf8')).toBe('utf-8');
  });

  it('should normalize iso-8859-1 variants', () => {
    expect(normalizeEncodingNameForTest('latin1')).toBe('iso-8859-1');
    expect(normalizeEncodingNameForTest('ISO-8859-1')).toBe('iso-8859-1');
  });

  it('should return original encoding if not in map', () => {
    expect(normalizeEncodingNameForTest('unknown-encoding')).toBe('unknown-encoding');
  });
});

describe('detectEncoding', () => {
  it('should return normalized encoding from HTML', () => {
    const html = '<html><head><meta charset="Shift_JIS"></head></html>';
    expect(detectEncoding(html)).toBe('shift_jis');
  });

  it('should return utf-8 for HTML without charset declaration', () => {
    const html = '<html><head></head></html>';
    expect(detectEncoding(html)).toBe('utf-8');
  });
});

describe('convertToUtf8', () => {
  it('should return UTF-8 HTML as-is', () => {
    const html = '<html><head><meta charset="UTF-8"></head><body>Hello</body></html>';
    const result = convertToUtf8(html);
    expect(result).toBe(html);
  });

  it('should return HTML without charset as-is (assumed UTF-8)', () => {
    const html = '<html><head></head><body>Hello World</body></html>';
    const result = convertToUtf8(html);
    expect(result).toBe(html);
  });

  it('should handle HTML with Shift_JIS declaration', () => {
    const html = '<html><head><meta charset="Shift_JIS"></head><body>Test</body></html>';
    const result = convertToUtf8(html);
    expect(result).toContain('Test');
  });

  it('should handle HTML with EUC-JP declaration', () => {
    const html = '<html><head><meta charset="EUC-JP"></head><body>Test</body></html>';
    const result = convertToUtf8(html);
    expect(result).toContain('Test');
  });

  it('should handle unsupported encoding gracefully', () => {
    const html = '<html><head><meta charset="unknown-encoding-xyz"></head><body>Test</body></html>';
    const result = convertToUtf8(html);
    expect(result).toBe(html);
  });
});
