// HTML encoding detection and conversion utility
// Execute with bun: wrangler dev

import iconv from 'iconv-lite';

const DEFAULT_ENCODING = 'utf-8';
const CHARSET_META_REGEX = /<meta[^>]+charset=["']?([^"'\s>]+)/i;
const CONTENT_TYPE_META_REGEX = /<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)/i;
const XML_ENCODING_REGEX = /<\?xml[^>]+encoding=["']([^"']+)/i;
const CHARSET_CONTENT_TYPE_REGEX = /charset=([^;\s]+)/i;

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

export const convertToUtf8 = (html: string, detectedCharset?: string): string => {
  // Use detected charset from browser if provided, otherwise detect from HTML
  let encoding: string;
  if (detectedCharset) {
    encoding = normalizeEncodingName(detectedCharset);
  } else {
    const detection = detectEncodingFromHtml(html);
    encoding = normalizeEncodingName(detection.encoding);
  }

  // Already UTF-8, return as-is
  if (isUtf8(encoding)) {
    return html;
  }

  // Check if iconv-lite supports this encoding
  if (!iconv.encodingExists(encoding)) {
    console.warn(`Unsupported encoding: ${encoding}, returning original HTML`);
    return html;
  }

  // Convert string to binary buffer using latin1 (preserves byte values)
  // then decode from the detected encoding to UTF-8
  const binaryBuffer = Buffer.from(html, 'latin1');
  const utf8Html = iconv.decode(binaryBuffer, encoding);

  // Update meta charset to UTF-8
  const updatedHtml = utf8Html
    .replace(CHARSET_META_REGEX, '<meta charset="UTF-8"')
    .replace(
      CONTENT_TYPE_META_REGEX,
      '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"',
    );

  return updatedHtml;
};

export const convertBufferToUtf8 = (buffer: Buffer, contentType?: string | null): string => {
  // Try to detect encoding from Content-Type header
  let encoding = DEFAULT_ENCODING;
  if (contentType) {
    const charsetMatch = contentType.match(CHARSET_CONTENT_TYPE_REGEX);
    if (charsetMatch?.[1]) {
      encoding = normalizeEncodingName(charsetMatch[1]);
    }
  }

  // If no encoding from header, try to detect from HTML content
  if (encoding === DEFAULT_ENCODING) {
    // Peek at the first part of the buffer as latin1 to find charset
    const preview = buffer.slice(0, 2048).toString('latin1');
    const detection = detectEncodingFromHtml(preview);
    encoding = normalizeEncodingName(detection.encoding);
  }

  // Decode buffer using detected encoding
  if (!iconv.encodingExists(encoding)) {
    console.warn(`Unsupported encoding: ${encoding}, falling back to UTF-8`);
    encoding = 'utf-8';
  }

  const html = iconv.decode(buffer, encoding);

  // Update meta charset to UTF-8 if not already
  if (!isUtf8(encoding)) {
    return html
      .replace(CHARSET_META_REGEX, '<meta charset="UTF-8"')
      .replace(
        CONTENT_TYPE_META_REGEX,
        '<meta http-equiv="Content-Type" content="text/html; charset=UTF-8"',
      );
  }

  return html;
};

export const detectEncoding = (html: string): string => {
  const detection = detectEncodingFromHtml(html);
  return normalizeEncodingName(detection.encoding);
};

export const normalizeEncodingNameForTest = (encoding: string): string =>
  normalizeEncodingName(encoding);

export const detectEncodingFromHtmlForTest = (html: string): EncodingDetectionResult =>
  detectEncodingFromHtml(html);
