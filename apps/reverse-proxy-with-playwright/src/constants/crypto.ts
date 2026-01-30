// Cryptographic constants
// Execute with bun: wrangler dev

// Password Hashing
export const PBKDF2_ITERATIONS = 10;
export const PBKDF2_KEY_LENGTH = 32;
export const PBKDF2_HASH_ALGORITHM = 'SHA-256';

// Numeric Base
export const HEX_BASE = 16;
export const HEX_PAD_LENGTH = 2;
export const BITS_PER_BYTE = 8;

// Base64 Encoding
export const BASE64_TRIPLET_SIZE = 3;
export const BASE64_6BIT_MASK = 0x3f;
export const BASE64_4BIT_MASK = 0xf;
export const BASE64_2BIT_MASK = 0x3;
export const BASE64_SHIFT_2 = 2;
export const BASE64_SHIFT_4 = 4;
export const BASE64_SHIFT_6 = 6;
