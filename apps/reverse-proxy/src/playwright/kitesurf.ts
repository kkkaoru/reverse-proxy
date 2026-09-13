// Execute with bun. Opt-in HTML extraction with operation-specific Chromium fallback.
import type { BrowserWorker } from '@cloudflare/playwright';
import type { FetchPageResponse } from './core.ts';
import { isAkamaiBlockBody } from './core.ts';

interface QuickActionOptions {
  browser: 'kitesurf';
  cacheTTL: 0;
  url: string;
  gotoOptions: { waitUntil: 'domcontentloaded' | 'networkidle2'; timeout: number };
}

export interface KitesurfBinding extends BrowserWorker {
  quickAction?: (action: 'content', options: QuickActionOptions) => Promise<Response>;
}

export interface KitesurfEnv {
  BROWSER?: KitesurfBinding;
  KITESURF_ACCOUNT_ID?: string;
  KITESURF_API_TOKEN?: string;
  // JSON object mapping exact, verified public URLs to required visible text.
  KITESURF_HTML_RULES?: string;
}

interface FetchHtmlParams {
  env: KitesurfEnv;
  url: string;
  fallback: () => Promise<FetchPageResponse>;
}

interface HtmlRule {
  text: string | string[];
  waitUntil: 'domcontentloaded' | 'networkidle2';
}

interface HtmlRequestParams {
  params: FetchHtmlParams;
  rule: HtmlRule;
  signal: AbortSignal;
}

interface HtmlResult {
  content: string;
  contentType: string;
  status: number;
}

const API_BASE: string = 'https://api.cloudflare.com/client/v4/accounts/';
const TIMEOUT_MS: number = 15000;
const CONTENT_TYPE: string = 'text/html; charset=utf-8';
const REPLACEMENT_LIMIT: number = 5;
const HTTP_OK: number = 200;
const HTTP_REDIRECT: number = 300;
const ACCOUNT_PATTERN: RegExp = /^[a-f0-9]{32}$/i;
const REPLACEMENT_PATTERN: RegExp = /\uFFFD/g;
const HIDDEN_CONTENT_PATTERN: RegExp = /<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
const TAG_PATTERN: RegExp = /<[^>]*>/g;
const BODY_PATTERN: RegExp = /<body\b[^>]*>([\s\S]*?)<\/body\s*>/i;
const CHALLENGE_PATTERN: RegExp = /just a moment|verify you are human|cf-chl-/i;
const REDIRECT_PATTERN: RegExp = /http-equiv\s*=\s*["']?refresh/i;
// Do not reject location assignments inside unrelated handlers on valid pages.

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isUnsupportedUrl = (url: URL): boolean =>
  url.protocol !== 'https:' || Boolean(url.username || url.password);

// The race root needs networkidle2 to finish its JS redirect in Kitesurf.
const supportedRule = (url: URL, rule: HtmlRule | null): HtmlRule | null =>
  url.hostname === 'race.netkeiba.com' && url.pathname === '/' && rule?.waitUntil !== 'networkidle2'
    ? null
    : rule;

const isTextMarker = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0;

const isMarker = (value: unknown): value is string | string[] =>
  isTextMarker(value) || (Array.isArray(value) && value.length > 0 && value.every(isTextMarker));

const parseRule = (value: unknown): HtmlRule | null => {
  if (typeof value === 'string')
    return value.trim() ? { text: value, waitUntil: 'domcontentloaded' } : null;
  if (!(isRecord(value) && isMarker(value.text))) return null;
  return value.waitUntil === 'domcontentloaded' || value.waitUntil === 'networkidle2'
    ? { text: value.text, waitUntil: value.waitUntil }
    : null;
};

const hasTransport = (env: KitesurfEnv): boolean =>
  typeof env.BROWSER?.quickAction === 'function' ||
  Boolean(env.KITESURF_API_TOKEN && ACCOUNT_PATTERN.test(env.KITESURF_ACCOUNT_ID ?? ''));

const ruleForUrl = (params: FetchHtmlParams): HtmlRule | null => {
  if (!(params.env.KITESURF_HTML_RULES && hasTransport(params.env))) return null;
  const url: URL = new URL(params.url);
  if (isUnsupportedUrl(url)) return null;
  const rules: unknown = JSON.parse(params.env.KITESURF_HTML_RULES);
  return supportedRule(url, parseRule(isRecord(rules) ? rules[params.url] : undefined));
};

const hasRequiredMarkers = (text: string, marker: string | string[]): boolean =>
  typeof marker === 'string'
    ? text.includes(marker)
    : marker.every((required: string) => text.includes(required));

const parseHtmlResult = (payload: unknown, marker: string | string[]): HtmlResult | null => {
  if (
    !isRecord(payload) ||
    payload.success !== true ||
    typeof payload.result !== 'string' ||
    !isRecord(payload.meta)
  )
    return null;
  const status: unknown = payload.meta.status;
  if (
    typeof status !== 'number' ||
    !Number.isInteger(status) ||
    status < HTTP_OK ||
    status >= HTTP_REDIRECT
  )
    return null;
  const html: string = payload.result;
  const body: string = BODY_PATTERN.exec(html)?.[1] ?? '';
  const visibleText: string = body.replace(HIDDEN_CONTENT_PATTERN, '').replace(TAG_PATTERN, ' ');
  if (
    !hasRequiredMarkers(visibleText, marker) ||
    isAkamaiBlockBody(html) ||
    CHALLENGE_PATTERN.test(html) ||
    REDIRECT_PATTERN.test(html) ||
    (html.match(REPLACEMENT_PATTERN)?.length ?? 0) >= REPLACEMENT_LIMIT
  )
    return null;
  return { content: html, contentType: CONTENT_TYPE, status };
};

const requestRest = ({ params, rule, signal }: HtmlRequestParams): Promise<Response> =>
  fetch(
    `${API_BASE}${params.env.KITESURF_ACCOUNT_ID}/browser-rendering/content?browser=kitesurf&cacheTTL=0`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${params.env.KITESURF_API_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        url: params.url,
        gotoOptions: { waitUntil: rule.waitUntil, timeout: TIMEOUT_MS },
      }),
      signal,
    },
  );

const requestHtml = ({ params, rule, signal }: HtmlRequestParams): Promise<Response> => {
  const binding: KitesurfBinding | undefined = params.env.BROWSER;
  const pending: Promise<Response> = binding?.quickAction
    ? binding.quickAction('content', {
        browser: 'kitesurf',
        cacheTTL: 0,
        url: params.url,
        gotoOptions: { waitUntil: rule.waitUntil, timeout: TIMEOUT_MS },
      })
    : requestRest({ params, rule, signal });
  return pending.then(async (response) => {
    if (signal.aborted) {
      await response.body?.cancel();
      throw new Error('Kitesurf deadline exceeded');
    }
    return response;
  });
};

const tryHtml = async (
  params: FetchHtmlParams,
  signal: AbortSignal,
): Promise<HtmlResult | null> => {
  const rule: HtmlRule | null = ruleForUrl(params);
  if (!rule) return null;
  const response: Response = await requestHtml({ params, rule, signal });
  if (!response.ok) {
    await response.body?.cancel();
    return null;
  }
  const payload: unknown = await response.json();
  return parseHtmlResult(payload, rule.text);
};

// Catch only the optional engine, never retry a failing fallback here.
export const fetchHtmlWithKitesurfFallback = async (
  params: FetchHtmlParams,
): Promise<FetchPageResponse> => {
  const controller: AbortController = new AbortController();
  const deadline: ReturnType<typeof setTimeout> = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const expired: Promise<null> = new Promise((resolve) => {
    controller.signal.addEventListener('abort', () => resolve(null), { once: true });
  });
  const result: HtmlResult | null = await Promise.race([
    tryHtml(params, controller.signal).catch(() => null),
    expired,
  ]).finally(() => clearTimeout(deadline));
  return result ?? params.fallback();
};
