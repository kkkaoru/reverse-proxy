// Detect pages that were fetched successfully but only contain an access gate.

// Markers that prove the visitor is signed in. They take precedence over the
// gate patterns below, because netkeiba leaves the "Premium_Regist_Box" DOM
// element on every page (just hidden via JS) once the visitor is signed in,
// which would otherwise produce a permanent false positive.
const AUTHENTICATED_SIGNATURES: readonly RegExp[] = [
  // netkeiba renders this header link only after sign-in (the signed-out
  // variant uses `Icon_Login`).
  /class=["'][^"']*\bIcon_Account\b/i,
  // The comment table receives this class on the server only for premium
  // subscribers; signed-out visitors get the preview table without it.
  /\bComment_Table_Show_All\b/,
];

const ACCESS_GATE_PATTERNS: readonly RegExp[] = [
  // The header sign-in link is only rendered when the visitor is NOT signed
  // in, which makes it a reliable structural marker for the gated state.
  /class=["'][^"']*\bIcon_Login\b/i,
  // Unauthenticated comment / paddock pages reveal the registration box via
  // JS (`.show()` or `.fadeIn(...)`). Authenticated pages call `.toggle(false)`
  // on the same element to keep it hidden.
  /\$\(['"]#Premium_Regist_Box[^'"]*['"]\)\.(?:show|fadeIn)\b/,
  /Premium_Regist_(?:Box|Box02|Btn)/i,
  /プレミアムサービス/i,
  /会員登録(?:を|で|すると)/i,
  /ログイン(?:して|すると).{0,80}(?:閲覧|利用|ご覧)/is,
  /(?:閲覧|利用|ご覧).{0,80}(?:ログイン|会員登録)/is,
];

const isAuthenticatedHtml = (html: string): boolean =>
  AUTHENTICATED_SIGNATURES.some((pattern) => pattern.test(html));

export const isAccessGateHtml = (html: string): boolean => {
  if (isAuthenticatedHtml(html)) return false;
  return ACCESS_GATE_PATTERNS.some((pattern) => pattern.test(html));
};
