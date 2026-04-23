// Akamai "Access Denied" block detection
// Execute with bun: wrangler dev
// Detects upstream responses that are Akamai CDN bot block pages, which can arrive
// as either 403 status or 200 status wrapping an Access Denied HTML body.

// Constants
// biome-ignore lint/nursery/noSecrets: Akamai CDN block page HTML marker, not a secret
export const AKAMAI_BLOCK_TITLE: string = '<TITLE>Access Denied</TITLE>';
export const AKAMAI_BLOCK_TITLE_LOWER: string = '<title>access denied</title>';
export const AKAMAI_BLOCK_HEADER_MARKER: string = '<h1>Access Denied</h1>';
export const AKAMAI_BLOCK_REFERENCE_MARKER: string = 'errors.edgesuite.net';
export const AKAMAI_BLOCK_PREVIEW_BYTES: number = 2048;
export const STATUS_FORBIDDEN: number = 403;

// Check if body preview matches any Akamai block marker
export const isAkamaiBlockBody = (bodyPreview: string): boolean => {
  if (!bodyPreview) return false;
  if (bodyPreview.includes(AKAMAI_BLOCK_TITLE)) return true;
  if (bodyPreview.includes(AKAMAI_BLOCK_TITLE_LOWER)) return true;
  if (bodyPreview.includes(AKAMAI_BLOCK_HEADER_MARKER)) return true;
  if (bodyPreview.includes(AKAMAI_BLOCK_REFERENCE_MARKER)) return true;
  return false;
};

// Read a limited preview of the response body (clones response so original stays intact)
export const readBodyPreview = async (response: Response): Promise<string> => {
  try {
    const clone: Response = response.clone();
    const text: string = await clone.text();
    return text.slice(0, AKAMAI_BLOCK_PREVIEW_BYTES);
  } catch {
    return '';
  }
};

// Detect Akamai block from response (status + body).
// Returns true for HTTP 403 OR HTTP 200 with Access Denied body markers.
export const isAkamaiBlockedResponse = async (response: Response): Promise<boolean> => {
  if (response.status === STATUS_FORBIDDEN) {
    return true;
  }
  const preview: string = await readBodyPreview(response);
  return isAkamaiBlockBody(preview);
};
