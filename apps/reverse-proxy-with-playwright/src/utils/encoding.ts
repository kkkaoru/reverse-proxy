// HTML encoding detection and conversion utility
// Execute with bun: wrangler dev

import iconv from 'iconv-lite';

const DEFAULT_ENCODING = 'utf-8';
const CHARSET_META_REGEX = /<meta[^>]+charset=["']?([^"'\s>]+)/i;
const CONTENT_TYPE_META_REGEX = /<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)/i;
const XML_ENCODING_REGEX = /<\?xml[^>]+encoding=["']([^"']+)/i;

interface EncodingDetectionResult {
  encoding: string;
  confidence: 'high' | 'medium' | 'low';
}

const detectEncodingFromHtml = (html: string): EncodingDetectionResult => {
  // Check for XML declaration encoding
  const xmlMatch = html.match(XML_ENCODING_REGEX);
  if (xmlMatch?.[1]) {
    return { encoding: xmlMatch[1].toLowerCase(), confidence: 'high' };
  }

  // Check for <meta charset="...">
  const charsetMatch = html.match(CHARSET_META_REGEX);
  if (charsetMatch?.[1]) {
    return { encoding: charsetMatch[1].toLowerCase(), confidence: 'high' };
  }

  // Check for <meta http-equiv="Content-Type" content="...; charset=...">
  const contentTypeMatch = html.match(CONTENT_TYPE_META_REGEX);
  if (contentTypeMatch?.[1]) {
    return { encoding: contentTypeMatch[1].toLowerCase(), confidence: 'high' };
  }

  return { encoding: DEFAULT_ENCODING, confidence: 'low' };
};

const normalizeEncodingName = (encoding: string): string => {
  const normalized = encoding.toLowerCase().replace(/[^a-z0-9]/g, '');

  const encodingMap: Record<string, string> = {
    shiftjis: 'shift_jis',
    sjis: 'shift_jis',
    xsjis: 'shift_jis',
    eucjp: 'euc-jp',
    xeucjp: 'euc-jp',
    iso2022jp: 'iso-2022-jp',
    utf8: 'utf-8',
    utf16: 'utf-16',
    utf16le: 'utf-16le',
    utf16be: 'utf-16be',
    ascii: 'ascii',
    usascii: 'ascii',
    latin1: 'iso-8859-1',
    iso88591: 'iso-8859-1',
  };

  return encodingMap[normalized] ?? encoding;
};

const isUtf8 = (encoding: string): boolean => {
  const normalized = normalizeEncodingName(encoding);
  return normalized === 'utf-8' || normalized === 'utf8';
};

export const convertToUtf8 = (html: string): string => {
  const detection = detectEncodingFromHtml(html);
  const encoding = normalizeEncodingName(detection.encoding);

  // Already UTF-8, return as-is
  if (isUtf8(encoding)) {
    return html;
  }

  // Check if iconv-lite supports this encoding
  if (!iconv.encodingExists(encoding)) {
    console.warn(`Unsupported encoding: ${encoding}, returning original HTML`);
    return html;
  }

  // Convert from detected encoding to UTF-8
  const buffer = iconv.encode(html, encoding);
  const utf8Html = iconv.decode(buffer, 'utf-8');

  return utf8Html;
};

export const detectEncoding = (html: string): string => {
  const detection = detectEncodingFromHtml(html);
  return normalizeEncodingName(detection.encoding);
};

export const normalizeEncodingNameForTest = (encoding: string): string =>
  normalizeEncodingName(encoding);

export const detectEncodingFromHtmlForTest = (html: string): EncodingDetectionResult =>
  detectEncodingFromHtml(html);
