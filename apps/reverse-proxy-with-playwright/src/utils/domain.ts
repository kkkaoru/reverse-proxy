// Domain extraction utility
// Execute with bun: wrangler dev

// netkeiba.com serves JRA pages from `race.netkeiba.com` and NAR pages
// from `nar.netkeiba.com`, with a single login on the parent domain
// setting cookies for `.netkeiba.com`. The sign-in selectors table and
// the Playwright storage state KV are both keyed by hostname, though,
// so the NAR subdomain would otherwise need its own selector row and
// its own signed-in storage. Canonicalize every `*.netkeiba.com`
// request back to `race.netkeiba.com` so both subdomains share the
// existing selector and the existing storage state, and the cookies
// captured during a JRA login transparently authenticate NAR fetches.
const NETKEIBA_CANONICAL_HOSTNAME = 'race.netkeiba.com';
const NETKEIBA_SUFFIX = '.netkeiba.com';

const canonicalizeHostname = (hostname: string): string => {
  if (hostname === 'netkeiba.com' || hostname.endsWith(NETKEIBA_SUFFIX)) {
    return NETKEIBA_CANONICAL_HOSTNAME;
  }
  return hostname;
};

export const extractDomain = (url: string): string => {
  try {
    const parsedUrl: URL = new URL(url);
    return canonicalizeHostname(parsedUrl.hostname);
  } catch {
    return '';
  }
};

export const isValidUrl = (url: string): boolean => {
  try {
    new URL(url);
    return true;
  } catch {
    return false;
  }
};
