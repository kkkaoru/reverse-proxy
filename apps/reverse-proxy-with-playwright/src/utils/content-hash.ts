// Content hashing utility for KV write deduplication
// Execute with bun: wrangler dev

const HEX_BYTE_LENGTH = 2;
const HEX_PAD_CHAR = '0';

const toHex = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(HEX_BYTE_LENGTH, HEX_PAD_CHAR))
    .join('');
};

export const computeContentHash = async (content: string): Promise<string> => {
  const encoded = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return toHex(digest);
};
