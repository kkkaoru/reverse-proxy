// HTML encoding detection and conversion utility
// Execute with bun: wrangler dev

import iconv from 'iconv-lite';

// Interfaces
interface EncodingDetectionResult {
  encoding: string;
  confidence: 'high' | 'medium' | 'low';
}

interface ConvertResponseParams {
  response: Response;
  bytes: Uint8Array;
  encoding: string;
}

// Constants
const DEFAULT_ENCODING: string = 'utf-8';
const CHARSET_META_REGEX: RegExp = /<meta[^>]+charset=["']?([^"'\s>]+)/i;
const CONTENT_TYPE_META_REGEX: RegExp = /<meta[^>]+content=["'][^"']*charset=([^"'\s;]+)/i;
const XML_ENCODING_REGEX: RegExp = /<\?xml[^>]+encoding=["']([^"']+)/i;
const CONTENT_TYPE_HTML_PREFIX: string = 'text/html';
const CONTENT_TYPE_HEADER: string = 'content-type';
const CHARSET_PREFIX: string = 'charset=';
const ENCODING_UTF8: string = 'utf-8';
const HEADER_CONTENT_TYPE_UTF8: string = 'text/html; charset=utf-8';
const LATIN1_ENCODING: string = 'latin1';
const CONFIDENCE_HIGH: 'high' = 'high';
const CONFIDENCE_LOW: 'low' = 'low';

// Encoding name normalization map
const ENCODING_NAME_MAP: Record<string, string> = {
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

// Functions
const normalizeEncodingName = (encoding: string): string => {
  const normalized: string = encoding.toLowerCase().replace(/[^a-z0-9]/g, '');
  return ENCODING_NAME_MAP[normalized] ?? encoding.toLowerCase();
};

const isUtf8Encoding = (encoding: string): boolean => {
  const normalized: string = normalizeEncodingName(encoding);
  return normalized === ENCODING_UTF8;
};

const detectEncodingFromHtml = (html: string): EncodingDetectionResult => {
  const xmlMatch: RegExpMatchArray | null = html.match(XML_ENCODING_REGEX);
  if (xmlMatch?.[1]) {
    return { encoding: normalizeEncodingName(xmlMatch[1]), confidence: CONFIDENCE_HIGH };
  }

  const charsetMatch: RegExpMatchArray | null = html.match(CHARSET_META_REGEX);
  if (charsetMatch?.[1]) {
    return { encoding: normalizeEncodingName(charsetMatch[1]), confidence: CONFIDENCE_HIGH };
  }

  const contentTypeMatch: RegExpMatchArray | null = html.match(CONTENT_TYPE_META_REGEX);
  if (contentTypeMatch?.[1]) {
    return { encoding: normalizeEncodingName(contentTypeMatch[1]), confidence: CONFIDENCE_HIGH };
  }

  return { encoding: DEFAULT_ENCODING, confidence: CONFIDENCE_LOW };
};

const extractCharsetFromContentType = (contentType: string): string | null => {
  const charsetIndex: number = contentType.toLowerCase().indexOf(CHARSET_PREFIX);
  if (charsetIndex === -1) {
    return null;
  }
  const charsetValue: string = contentType.slice(charsetIndex + CHARSET_PREFIX.length);
  const semicolonIndex: number = charsetValue.indexOf(';');
  const rawCharset: string =
    semicolonIndex === -1 ? charsetValue : charsetValue.slice(0, semicolonIndex);
  return normalizeEncodingName(rawCharset.trim().replace(/["']/g, ''));
};

const isHtmlContentType = (contentType: string): boolean =>
  contentType.toLowerCase().startsWith(CONTENT_TYPE_HTML_PREFIX);

const createConvertedResponse = (params: ConvertResponseParams): Response => {
  const utf8Content: string = iconv.decode(Buffer.from(params.bytes), params.encoding);
  const headers: Headers = new Headers(params.response.headers);
  headers.set(CONTENT_TYPE_HEADER, HEADER_CONTENT_TYPE_UTF8);

  return new Response(utf8Content, {
    status: params.response.status,
    statusText: params.response.statusText,
    headers,
  });
};

export const convertResponseToUtf8 = async (response: Response): Promise<Response> => {
  const contentType: string = response.headers.get(CONTENT_TYPE_HEADER) ?? '';

  if (!isHtmlContentType(contentType)) {
    return response;
  }

  const headerCharset: string | null = extractCharsetFromContentType(contentType);
  if (headerCharset && isUtf8Encoding(headerCharset)) {
    return response;
  }

  const bytes: Uint8Array = new Uint8Array(await response.clone().arrayBuffer());
  const latin1Html: string = iconv.decode(Buffer.from(bytes), LATIN1_ENCODING);
  const detection: EncodingDetectionResult = detectEncodingFromHtml(latin1Html);
  const encoding: string = headerCharset ?? detection.encoding;

  if (isUtf8Encoding(encoding)) {
    return response;
  }

  if (!iconv.encodingExists(encoding)) {
    return response;
  }

  return createConvertedResponse({ response, bytes, encoding });
};

export const detectEncodingFromHtmlForTest = (html: string): EncodingDetectionResult =>
  detectEncodingFromHtml(html);

export const normalizeEncodingNameForTest = (encoding: string): string =>
  normalizeEncodingName(encoding);

export const extractCharsetFromContentTypeForTest = (contentType: string): string | null =>
  extractCharsetFromContentType(contentType);

export const isHtmlContentTypeForTest = (contentType: string): boolean =>
  isHtmlContentType(contentType);
