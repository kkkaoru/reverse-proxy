// Akamai block page detection
// Execute with bun: wrangler dev

const AKAMAI_BLOCK_TITLE = '<TITLE>Access Denied</TITLE>';
const AKAMAI_BLOCK_TITLE_LOWER = '<title>access denied</title>';
const AKAMAI_BLOCK_HEADER_MARKER = '<h1>Access Denied</h1>';
const AKAMAI_BLOCK_REFERENCE_MARKER = 'errors.edgesuite.net';
const AKAMAI_BLOCK_PREVIEW_BYTES = 2048;

export const AKAMAI_BLOCK_PAGE_ERROR = 'Akamai block page returned to browser';

export const isAkamaiBlockBody = (body: string): boolean => {
  if (!body) {
    return false;
  }
  const preview = body.slice(0, AKAMAI_BLOCK_PREVIEW_BYTES);
  return (
    preview.includes(AKAMAI_BLOCK_TITLE) ||
    preview.includes(AKAMAI_BLOCK_TITLE_LOWER) ||
    preview.includes(AKAMAI_BLOCK_HEADER_MARKER) ||
    preview.includes(AKAMAI_BLOCK_REFERENCE_MARKER)
  );
};
