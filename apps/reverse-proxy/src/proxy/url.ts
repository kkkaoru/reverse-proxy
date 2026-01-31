// URL utilities for proxy
// Execute with bun: wrangler dev

import {
  ALLOWED_PROTOCOLS,
  BLOCKED_HOSTNAMES,
  BLOCKED_IP_PATTERNS,
  ERROR_BLOCKED_HOST,
  ERROR_BLOCKED_PROTOCOL,
  ERROR_INVALID_URL,
  ERROR_PRIVATE_IP,
} from './constants.ts';
import type { ParsedUrl, SsrfValidationResult } from './types.ts';

// Constants
export const FORWARD_PARAMS: readonly string[] = ['word'];
export const QUERY_STRING_START_INDEX: number = 1;
export const QUERY_SEPARATOR_INITIAL: string = '?';
export const QUERY_SEPARATOR_APPEND: string = '&';

// URL parsing
export const parseTargetUrl = (raw: string): ParsedUrl => {
  try {
    return { success: true, value: new URL(raw) };
  } catch {
    return { success: false, message: ERROR_INVALID_URL };
  }
};

// Extract raw parameter value from query string (preserves original encoding like EUC-JP)
export const extractRawParamValue = (rawQuery: string, paramName: string): string | undefined => {
  const pattern: RegExp = new RegExp(`(?:^|&)${paramName}=([^&]*)`, 'i');
  const match: RegExpMatchArray | null = rawQuery.match(pattern);
  return match?.[1];
};

// Check if URL already has the specified parameter
export const urlHasParam = (url: string, param: string): boolean => {
  try {
    return new URL(url).searchParams.has(param);
  } catch {
    return true; // Treat invalid URLs as having the param to skip appending
  }
};

// Get query separator based on whether URL already has query string
export const getQuerySeparator = (url: string): string =>
  url.includes(QUERY_SEPARATOR_INITIAL) ? QUERY_SEPARATOR_APPEND : QUERY_SEPARATOR_INITIAL;

// Append single parameter to URL if conditions are met
export const appendParamIfNeeded = (url: string, rawQuery: string, param: string): string => {
  const rawValue: string | undefined = extractRawParamValue(rawQuery, param);
  if (rawValue === undefined) {
    return url;
  }
  if (urlHasParam(url, param)) {
    return url;
  }
  const separator: string = getQuerySeparator(url);
  return `${url}${separator}${param}=${rawValue}`;
};

// Build target URL by appending forwarded parameters from proxy request
export const buildTargetUrl = (baseUrl: string, rawProxyQuery: string): string =>
  FORWARD_PARAMS.reduce(
    (url: string, param: string): string => appendParamIfNeeded(url, rawProxyQuery, param),
    baseUrl,
  );

// Extract raw query string from request URL
export const extractRawQuery = (requestUrl: string): string =>
  new URL(requestUrl).search.slice(QUERY_STRING_START_INDEX);

// SSRF validation functions
export const isAllowedProtocol = (url: URL): boolean => ALLOWED_PROTOCOLS.includes(url.protocol);

export const isBlockedHostname = (hostname: string): boolean =>
  BLOCKED_HOSTNAMES.includes(hostname.toLowerCase());

// Strip brackets from IPv6 addresses for pattern matching
const stripIpv6Brackets = (hostname: string): string =>
  hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname;

export const isPrivateIp = (hostname: string): boolean => {
  const bareHostname: string = stripIpv6Brackets(hostname);
  return BLOCKED_IP_PATTERNS.some((pattern: RegExp): boolean => pattern.test(bareHostname));
};

export const validateUrlWithSsrf = (raw: string): SsrfValidationResult => {
  const parsed: ParsedUrl = parseTargetUrl(raw);

  if (!parsed.success) {
    return { valid: false, reason: parsed.message };
  }

  const url: URL = parsed.value;

  if (!isAllowedProtocol(url)) {
    return { valid: false, reason: ERROR_BLOCKED_PROTOCOL };
  }

  if (isBlockedHostname(url.hostname)) {
    return { valid: false, reason: ERROR_BLOCKED_HOST };
  }

  if (isPrivateIp(url.hostname)) {
    return { valid: false, reason: ERROR_PRIVATE_IP };
  }

  return { valid: true, url };
};
