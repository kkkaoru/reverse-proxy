// Content hashing helper shared by KV cache write paths.
// Used to skip redundant KV `put`s when the new content is byte-identical
// to the already-cached content (stored as KV metadata).
// Execute with bun: wrangler dev

const HEX_RADIX: number = 16;
const HEX_PAD_LENGTH: number = 2;

const toHex = (byte: number): string => byte.toString(HEX_RADIX).padStart(HEX_PAD_LENGTH, '0');

// SHA-256 hex digest of the given content using the Workers Web Crypto API.
export const computeContentHash = async (content: string): Promise<string> => {
  const encoded: Uint8Array<ArrayBuffer> = new TextEncoder().encode(content);
  const digest: ArrayBuffer = await crypto.subtle.digest('SHA-256', encoded.buffer);
  const bytes: readonly number[] = Array.from(new Uint8Array(digest));
  return bytes.map(toHex).join('');
};
