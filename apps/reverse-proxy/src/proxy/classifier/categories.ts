// Abstract failure categories used by the classifier + routing strategy
// pipeline. Domain-specific patterns (Akamai HTML, mojibake, netkeiba
// truncation markers) are mapped into these categories so the proxy
// core can pick a routing strategy without knowing the upstream details.
// Execute with bun: wrangler dev

// `null` means "not a failure" (the response is acceptable as-is).
export type FailureCategory =
  | 'transient-upstream'
  | 'bot-protection'
  | 'payload-corrupted'
  | 'client-error'
  | null;

// Routing preference selected by the strategy table for each failure
// category. The proxy attempt loop interprets these as a hint for which
// retry path to favour:
//   - 'prefer-ip-rotate': fall through to AWS API Gateway IP rotate.
//   - 'prefer-browser': fall through to /playwright (CF Browser).
//   - 'pass-through': return the response as-is (success or terminal
//     client error).
//   - 'fail': do not retry; surface the response immediately.
export type RoutingPreference = 'prefer-ip-rotate' | 'prefer-browser' | 'pass-through' | 'fail';

const TRANSIENT_UPSTREAM: FailureCategory = 'transient-upstream' satisfies FailureCategory;
const BOT_PROTECTION: FailureCategory = 'bot-protection' satisfies FailureCategory;
const PAYLOAD_CORRUPTED: FailureCategory = 'payload-corrupted' satisfies FailureCategory;
const CLIENT_ERROR: FailureCategory = 'client-error' satisfies FailureCategory;

const PREFER_IP_ROTATE: RoutingPreference = 'prefer-ip-rotate' satisfies RoutingPreference;
const PREFER_BROWSER: RoutingPreference = 'prefer-browser' satisfies RoutingPreference;
const PASS_THROUGH: RoutingPreference = 'pass-through' satisfies RoutingPreference;
const FAIL: RoutingPreference = 'fail' satisfies RoutingPreference;

// Default routing strategy. transient-upstream / payload-corrupted both
// route to IP-rotate first because re-fetching from a different egress
// region tends to clear AWS API Gateway burst throttle and resolves
// truncated / mojibake bodies that are usually a single-region artefact.
// bot-protection routes to browser because that is the only path that
// can execute the JS challenge / serve a real session cookie.
const DEFAULT_ROUTING_TABLE: ReadonlyMap<FailureCategory, RoutingPreference> = new Map<
  FailureCategory,
  RoutingPreference
>([
  [TRANSIENT_UPSTREAM, PREFER_IP_ROTATE],
  [BOT_PROTECTION, PREFER_BROWSER],
  [PAYLOAD_CORRUPTED, PREFER_IP_ROTATE],
  [CLIENT_ERROR, FAIL],
  [null, PASS_THROUGH],
]);

export const routeForCategory = (category: FailureCategory): RoutingPreference =>
  DEFAULT_ROUTING_TABLE.get(category) ?? PASS_THROUGH;

interface FailureCategoryValues {
  readonly TRANSIENT_UPSTREAM: FailureCategory;
  readonly BOT_PROTECTION: FailureCategory;
  readonly PAYLOAD_CORRUPTED: FailureCategory;
  readonly CLIENT_ERROR: FailureCategory;
}

interface RoutingPreferenceValues {
  readonly PREFER_IP_ROTATE: RoutingPreference;
  readonly PREFER_BROWSER: RoutingPreference;
  readonly PASS_THROUGH: RoutingPreference;
  readonly FAIL: RoutingPreference;
}

export const FAILURE_CATEGORY_VALUES: FailureCategoryValues = {
  TRANSIENT_UPSTREAM,
  BOT_PROTECTION,
  PAYLOAD_CORRUPTED,
  CLIENT_ERROR,
};

export const ROUTING_PREFERENCE_VALUES: RoutingPreferenceValues = {
  PREFER_IP_ROTATE,
  PREFER_BROWSER,
  PASS_THROUGH,
  FAIL,
};
