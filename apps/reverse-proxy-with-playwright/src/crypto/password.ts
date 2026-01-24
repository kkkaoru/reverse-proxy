// Password hashing utility using PBKDF2
// Execute with bun: wrangler dev

import {
  BITS_PER_BYTE,
  HEX_BASE,
  HEX_PAD_LENGTH,
  PBKDF2_HASH_ALGORITHM,
  PBKDF2_ITERATIONS,
  PBKDF2_KEY_LENGTH,
} from '../constants.ts';

export interface HashPasswordParams {
  password: string;
  salt: string;
  pepper: string;
}

const encoder: TextEncoder = new TextEncoder();

const arrayBufferToHex = (buffer: ArrayBuffer): string =>
  Array.from(new Uint8Array(buffer))
    .map((byte: number) => byte.toString(HEX_BASE).padStart(HEX_PAD_LENGTH, '0'))
    .join('');

const uint8ArrayToArrayBuffer = (arr: Uint8Array): ArrayBuffer => {
  const buffer: ArrayBuffer = new ArrayBuffer(arr.byteLength);
  new Uint8Array(buffer).set(arr);
  return buffer;
};

export const hashPassword = async (params: HashPasswordParams): Promise<string> => {
  const combinedPassword: string = `${params.pepper}${params.password}`;
  const passwordData: Uint8Array = encoder.encode(combinedPassword);
  const saltData: Uint8Array = encoder.encode(params.salt);

  const keyMaterial: CryptoKey = await crypto.subtle.importKey(
    'raw',
    uint8ArrayToArrayBuffer(passwordData),
    'PBKDF2',
    false,
    ['deriveBits'],
  );

  const derivedBits: ArrayBuffer = await crypto.subtle.deriveBits(
    {
      name: 'PBKDF2',
      salt: uint8ArrayToArrayBuffer(saltData),
      iterations: PBKDF2_ITERATIONS,
      hash: PBKDF2_HASH_ALGORITHM,
    },
    keyMaterial,
    PBKDF2_KEY_LENGTH * BITS_PER_BYTE,
  );

  return arrayBufferToHex(derivedBits);
};

export const verifyPassword = async (
  params: HashPasswordParams,
  hash: string,
): Promise<boolean> => {
  const computedHash: string = await hashPassword(params);
  return computedHash === hash;
};
