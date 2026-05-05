// Domain-agnostic response classifier.
// Execute with bun: wrangler dev
//
// Each rule is a small predicate that maps a (Response, body preview)
// pair to a FailureCategory. Rules run in priority order (most specific
// first) and the first match wins. The classifier itself knows nothing
// about netkeiba; netkeiba-specific signals (Akamai block markers,
// mojibake density, truncated payloads) are encoded as individual rules
// that can be reused or replaced for other upstreams.
//
// Adding support for a new upstream means writing a new rule (or set
// of rules) and prepending it to a Classifier instance.

import { isAkamaiBlockBody } from '../fetch/akamai.ts';
import { isTransientUpstreamFailureStatus } from '../fetch/status.ts';
import type { FailureCategory } from './categories.ts';
import { FAILURE_CATEGORY_VALUES } from './categories.ts';

// Constants
const REDIRECT_START: number = 300 satisfies number;
const CLIENT_ERROR_START: number = 400 satisfies number;
const SERVER_ERROR_START: number = 500 satisfies number;
const REPLACEMENT_CHAR_REGEX: RegExp = /�/g;
const MOJIBAKE_THRESHOLD: number = 5 satisfies number;
const PREVIEW_BYTES: number = 4096 satisfies number;
const ZERO_LENGTH: number = 0 satisfies number;

// Body-shape rules apply only to 2xx responses. Redirects (3xx) and
// errors (4xx/5xx) routinely carry empty bodies and that is not an
// upstream defect — handling them is the responsibility of the
// status-based rules above.
const isBodyShapeApplicable = (status: number): boolean => status < REDIRECT_START;

interface ClassifierContext {
  readonly response: Response;
  readonly bodyPreview: string;
}

type ClassifierRule = (ctx: ClassifierContext) => FailureCategory | undefined;

const countReplacementChars = (text: string): number => {
  const matches: RegExpMatchArray | null = text.match(REPLACEMENT_CHAR_REGEX);
  return matches?.length ?? 0;
};

const isMojibakeBody = (body: string): boolean => countReplacementChars(body) >= MOJIBAKE_THRESHOLD;

// Rule: 4xx client errors that are NOT 408/429 are terminal. They are
// not netkeiba-specific — any upstream that says "you asked for X and
// X does not exist" should not be retried via IP rotate / browser.
const ruleClientError: ClassifierRule = (ctx: ClassifierContext): FailureCategory | undefined => {
  const status: number = ctx.response.status;
  if (status < CLIENT_ERROR_START) return undefined;
  if (status >= SERVER_ERROR_START) return undefined;
  if (isTransientUpstreamFailureStatus(status)) return undefined;
  return FAILURE_CATEGORY_VALUES.CLIENT_ERROR;
};

// Rule: transient upstream failure (5xx, 429, 408, 6xx, 400 burst).
// The status check already excludes Cloudflare 533 (worker resource
// exhausted) which IP-rotate cannot fix.
const ruleTransientUpstream: ClassifierRule = (
  ctx: ClassifierContext,
): FailureCategory | undefined =>
  isTransientUpstreamFailureStatus(ctx.response.status)
    ? FAILURE_CATEGORY_VALUES.TRANSIENT_UPSTREAM
    : undefined;

// Rule: Akamai (and similar) bot-protection HTML page wrapped in a 200.
// The status code looks healthy but the body is a CDN block. Skip for
// non-2xx responses where an empty body is expected.
const ruleBotProtection: ClassifierRule = (ctx: ClassifierContext): FailureCategory | undefined => {
  if (!isBodyShapeApplicable(ctx.response.status)) return undefined;
  return isAkamaiBlockBody(ctx.bodyPreview) ? FAILURE_CATEGORY_VALUES.BOT_PROTECTION : undefined;
};

// Rule: empty body returned with 2xx. Fairly common when an upstream
// edge has a partial outage — IP rotate to a different region usually
// fixes it. Skipped for redirects / errors where empty bodies are
// expected. Domain-specific "this body shape is wrong" checks (e.g.
// the netkeiba `block=horse_results` marker) live in the keiba client
// library; the proxy layer just notices "you asked for HTML and got
// nothing" and bumps the request to IP-rotate.
const ruleEmptyBody: ClassifierRule = (ctx: ClassifierContext): FailureCategory | undefined => {
  if (!isBodyShapeApplicable(ctx.response.status)) return undefined;
  return ctx.bodyPreview.length === ZERO_LENGTH
    ? FAILURE_CATEGORY_VALUES.PAYLOAD_CORRUPTED
    : undefined;
};

// Rule: mojibake density above the threshold. EUC-JP / Shift_JIS pages
// served as UTF-8 by a misconfigured edge produce U+FFFD replacement
// chars. Re-fetch from a different region tends to land on a healthy
// edge. Skipped for redirects / errors.
const ruleMojibake: ClassifierRule = (ctx: ClassifierContext): FailureCategory | undefined => {
  if (!isBodyShapeApplicable(ctx.response.status)) return undefined;
  return isMojibakeBody(ctx.bodyPreview) ? FAILURE_CATEGORY_VALUES.PAYLOAD_CORRUPTED : undefined;
};

// Default rule chain. Order matters: status-based rules run first so a
// 4xx never gets mis-classified as bot-protection just because the
// upstream's 4xx page happens to contain "Access Denied" copy.
const DEFAULT_RULES: readonly ClassifierRule[] = [
  ruleClientError,
  ruleTransientUpstream,
  ruleBotProtection,
  ruleEmptyBody,
  ruleMojibake,
];

const readBodyPreview = async (response: Response): Promise<string> => {
  try {
    const clone: Response = response.clone();
    const text: string = await clone.text();
    return text.slice(ZERO_LENGTH, PREVIEW_BYTES);
  } catch {
    return '';
  }
};

const evaluateRules = (
  rules: readonly ClassifierRule[],
  ctx: ClassifierContext,
): FailureCategory => {
  for (const rule of rules) {
    const verdict: FailureCategory | undefined = rule(ctx);
    if (verdict !== undefined) return verdict;
  }
  return null;
};

interface ClassifyResponseParams {
  readonly response: Response;
  readonly rules?: readonly ClassifierRule[];
}

/**
 * Classify a response into a FailureCategory using the supplied rules
 * (or the default rule chain). Reads up to PREVIEW_BYTES bytes of the
 * body once and shares the preview across rules so the response stream
 * is not consumed multiple times.
 */
export const classifyResponse = async ({
  response,
  rules,
}: ClassifyResponseParams): Promise<FailureCategory> => {
  const bodyPreview: string = await readBodyPreview(response);
  const ctx: ClassifierContext = { response, bodyPreview };
  return evaluateRules(rules ?? DEFAULT_RULES, ctx);
};

export { DEFAULT_RULES };
export type { ClassifierContext, ClassifierRule };
