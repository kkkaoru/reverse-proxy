// Execute with bun. Reject redirect interstitials before accepting IP-rotate HTML.
const HTTP_REDIRECT_TITLE: RegExp = /<title>\s*30[12378]\s+[^<]*<\/title>/i;
const MOVED_MESSAGE: RegExp = /the document has moved\b/i;
const SCRIPT_NAVIGATION: RegExp =
  /<script\b[^>]*>[\s\S]*?\blocation(?:\.href\s*=|\s*=|\.(?:assign|replace)\s*\()/i;
const HIDDEN_HTML: RegExp = /<(head|script|style)\b[^>]*>[\s\S]*?<\/\1\s*>|<!--[\s\S]*?-->/gi;
const HTML_TAG: RegExp = /<[^>]*>/g;

export const isNavigationStub = (html: string): boolean =>
  (HTTP_REDIRECT_TITLE.test(html) && MOVED_MESSAGE.test(html)) ||
  (SCRIPT_NAVIGATION.test(html) &&
    html.replace(HIDDEN_HTML, '').replace(HTML_TAG, '').trim().length === 0);
