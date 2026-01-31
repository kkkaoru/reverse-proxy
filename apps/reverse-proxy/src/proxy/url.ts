// URL utilities for proxy
// Execute with bun: wrangler dev

import { ERROR_INVALID_URL } from './constants.ts';
import type { ParsedUrl } from './types.ts';

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
