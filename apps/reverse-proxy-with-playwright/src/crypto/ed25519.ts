// ED25519 signature verification utility
// Execute with bun: wrangler dev

import { getPublicKeyAsync, signAsync, verifyAsync } from '@noble/ed25519';
import {
  BASE64_2BIT_MASK,
  BASE64_4BIT_MASK,
  BASE64_6BIT_MASK,
  BASE64_SHIFT_2,
  BASE64_SHIFT_4,
  BASE64_SHIFT_6,
  BASE64_TRIPLET_SIZE,
} from '../constants.ts';

const OPENSSH_ED25519_HEADER = 'openssh-key-v1';
const PRIVATE_KEY_LENGTH = 64;
const PUBLIC_KEY_OFFSET = 32;
const BASE64_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const PEM_HEADER = '-----BEGIN OPENSSH PRIVATE KEY-----';
const PEM_FOOTER = '-----END OPENSSH PRIVATE KEY-----';
const HEADER_LENGTH = 15;
const BIT_SHIFT_24 = 24;
const BIT_SHIFT_16 = 16;
const BIT_SHIFT_8 = 8;
const UINT32_SIZE = 4;

export interface VerifySignatureParams {
  message: string;
  signature: string;
  secretKeyBase64: string;
}

const decodeBase64 = (base64: string): Uint8Array => {
  const cleanBase64: string = base64.replace(/[\r\n\s]/g, '');
  const binaryString: string = atob(cleanBase64);
  const bytes: Uint8Array = new Uint8Array(binaryString.length);
  bytes.set(binaryString.split('').map((char: string) => char.charCodeAt(0)));
  return bytes;
};

interface Base64TripletParams {
  a: number;
  b: number;
  c: number;
  hasB: boolean;
  hasC: boolean;
}

const encodeBase64Triplet = (params: Base64TripletParams): string => {
  const char1: string = BASE64_CHARS[(params.a >> BASE64_SHIFT_2) & BASE64_6BIT_MASK] ?? '';
  const char2: string =
    BASE64_CHARS[
      ((params.a & BASE64_2BIT_MASK) << BASE64_SHIFT_4) |
        ((params.b >> BASE64_SHIFT_4) & BASE64_4BIT_MASK)
    ] ?? '';
  const char3: string = params.hasB
    ? (BASE64_CHARS[
        ((params.b & BASE64_4BIT_MASK) << BASE64_SHIFT_2) |
          ((params.c >> BASE64_SHIFT_6) & BASE64_2BIT_MASK)
      ] ?? '')
    : '=';
  const char4: string = params.hasC ? (BASE64_CHARS[params.c & BASE64_6BIT_MASK] ?? '') : '=';
  return `${char1}${char2}${char3}${char4}`;
};

const encodeBase64 = (bytes: Uint8Array): string => {
  const length: number = bytes.length;
  const tripletCount: number = Math.ceil(length / BASE64_TRIPLET_SIZE);
  const chunks: readonly string[] = Array.from({ length: tripletCount }, (_, idx: number) => {
    const i: number = idx * BASE64_TRIPLET_SIZE;
    return encodeBase64Triplet({
      a: bytes[i] ?? 0,
      b: bytes[i + 1] ?? 0,
      c: bytes[i + 2] ?? 0,
      hasB: i + 1 < length,
      hasC: i + 2 < length,
    });
  });
  return chunks.join('');
};

interface KeyDataReader {
  readUint32: () => number;
  readString: () => Uint8Array;
}

interface ReaderState {
  offset: number;
}

const readUint32FromData = (data: Uint8Array, state: ReaderState): number => {
  const value: number =
    ((data[state.offset] ?? 0) << BIT_SHIFT_24) |
    ((data[state.offset + 1] ?? 0) << BIT_SHIFT_16) |
    ((data[state.offset + 2] ?? 0) << BIT_SHIFT_8) |
    (data[state.offset + 3] ?? 0);
  state.offset += UINT32_SIZE;
  return value;
};

const readStringFromData = (data: Uint8Array, state: ReaderState): Uint8Array => {
  const length: number = readUint32FromData(data, state);
  const result: Uint8Array = data.slice(state.offset, state.offset + length);
  state.offset += length;
  return result;
};

const createKeyDataReader = (data: Uint8Array, initialOffset: number): KeyDataReader => {
  const state: ReaderState = { offset: initialOffset };
  return {
    readUint32: (): number => readUint32FromData(data, state),
    readString: (): Uint8Array => readStringFromData(data, state),
  };
};

const extractPrivateKeyFromSection = (privateSection: Uint8Array): Uint8Array => {
  const reader: KeyDataReader = createKeyDataReader(privateSection, 0);

  reader.readUint32();
  reader.readUint32();
  reader.readString();
  reader.readString();

  const privateKeyFull: Uint8Array = reader.readString();

  if (privateKeyFull.length !== PRIVATE_KEY_LENGTH) {
    throw new Error('Invalid ED25519 private key length');
  }

  return privateKeyFull.slice(0, PUBLIC_KEY_OFFSET);
};

const parseOpenSshPrivateKey = (keyData: Uint8Array): Uint8Array => {
  const decoder: TextDecoder = new TextDecoder();

  const header: string = decoder.decode(keyData.slice(0, HEADER_LENGTH));
  if (!header.startsWith(OPENSSH_ED25519_HEADER)) {
    throw new Error('Invalid OpenSSH key format');
  }

  const reader: KeyDataReader = createKeyDataReader(keyData, HEADER_LENGTH);

  reader.readString();
  reader.readString();
  reader.readString();
  reader.readUint32();
  reader.readString();

  const privateSection: Uint8Array = reader.readString();

  return extractPrivateKeyFromSection(privateSection);
};

const extractPemContent = (pemText: string): string => {
  const lines: readonly string[] = pemText.split('\n');
  const contentLines: readonly string[] = lines.filter(
    (line: string) => !line.startsWith('-----') && line.trim().length > 0,
  );
  return contentLines.join('');
};

export const extractEd25519PrivateKey = (secretKeyBase64: string): Uint8Array => {
  const decodedBytes: Uint8Array = decodeBase64(secretKeyBase64);
  const decoder: TextDecoder = new TextDecoder();
  const pemText: string = decoder.decode(decodedBytes);

  if (pemText.includes(PEM_HEADER) && pemText.includes(PEM_FOOTER)) {
    const innerBase64: string = extractPemContent(pemText);
    const binaryData: Uint8Array = decodeBase64(innerBase64);
    return parseOpenSshPrivateKey(binaryData);
  }

  return parseOpenSshPrivateKey(decodedBytes);
};

export const signEd25519Message = async (
  message: string,
  secretKeyBase64: string,
): Promise<string> => {
  const privateKeyBytes: Uint8Array = extractEd25519PrivateKey(secretKeyBase64);
  const encoder: TextEncoder = new TextEncoder();
  const messageBytes: Uint8Array = encoder.encode(message);

  const signature: Uint8Array = await signAsync(messageBytes, privateKeyBytes);

  return encodeBase64(signature);
};

export const verifyEd25519Signature = async (params: VerifySignatureParams): Promise<boolean> => {
  try {
    const privateKeyBytes: Uint8Array = extractEd25519PrivateKey(params.secretKeyBase64);
    const encoder: TextEncoder = new TextEncoder();
    const messageBytes: Uint8Array = encoder.encode(params.message);
    const signatureBytes: Uint8Array = decodeBase64(params.signature);

    const publicKey: Uint8Array = await getPublicKeyAsync(privateKeyBytes);

    return await verifyAsync(signatureBytes, messageBytes, publicKey);
  } catch {
    return false;
  }
};
