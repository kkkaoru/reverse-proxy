// Tests for ED25519 signature utility
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import {
  extractEd25519PrivateKey,
  signEd25519Message,
  verifyEd25519Signature,
} from '../../src/crypto/ed25519.ts';

const BASE64_SIGNATURE_REGEX: RegExp = /^[A-Za-z0-9+/]+=*$/;

// Test key from README - OpenSSH ED25519 private key base64
const TEST_SECRET_KEY_BASE64 =
  'LS0tLS1CRUdJTiBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0KYjNCbGJuTnphQzFyWlhrdGRqRUFBQUFBQkc1dmJtVUFBQUFFYm05dVpRQUFBQUFBQUFBQkFBQUFNd0FBQUF0emMyZ3RaVwpReU5UVXhPUUFBQUNBVnlwakd1ZEkrT1hrdENaZG8vc2lMWkwxZXBYOGx6eUJ0MEMzSEFMOWJaUUFBQUpCUHVKcUFUN2lhCmdBQUFBQXR6YzJndFpXUXlOVFV4T1FBQUFDQVZ5cGpHdWRJK09Ya3RDWmRvL3NpTFpMMWVwWDhsenlCdDBDM0hBTDliWlEKQUFBRUNvb3hzYUpVMzdyMWFRcU5JZ2daTXlMTlY1VWdmalErcVU3aU5zTkIxVkhSWEttTWE1MGo0NWVTMEpsMmoreUl0awp2VjZsZnlYUElHM1FMY2NBdjF0bEFBQUFEWEpsZG1WeWMyVXRjSEp2ZUhrPQotLS0tLUVORCBPUEVOU1NIIFBSSVZBVEUgS0VZLS0tLS0K';

describe('extractEd25519PrivateKey', () => {
  it('should extract private key from OpenSSH format', () => {
    const privateKey: Uint8Array = extractEd25519PrivateKey(TEST_SECRET_KEY_BASE64);
    expect(privateKey.length).toBe(32);
  });

  it('should throw error for invalid key format', () => {
    const invalidKey: string = btoa('invalid key data');
    expect(() => extractEd25519PrivateKey(invalidKey)).toThrow('Invalid OpenSSH key format');
  });

  it('should handle non-PEM format directly', () => {
    const invalidBinaryKey: string = btoa(`openssh-key-v1${'\0'.repeat(100)}`);
    expect(() => extractEd25519PrivateKey(invalidBinaryKey)).toThrow();
  });
});

describe('signEd25519Message', () => {
  it('should sign a message', async () => {
    const message = 'test message';
    const signature: string = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);
    expect(signature).toMatch(BASE64_SIGNATURE_REGEX);
    expect(signature.length).toBeGreaterThan(0);
  });

  it('should generate consistent signatures for same message', async () => {
    const message = 'consistent test message';
    const signature1: string = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);
    const signature2: string = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);
    expect(signature1).toStrictEqual(signature2);
  });

  it('should generate different signatures for different messages', async () => {
    const signature1: string = await signEd25519Message('message1', TEST_SECRET_KEY_BASE64);
    const signature2: string = await signEd25519Message('message2', TEST_SECRET_KEY_BASE64);
    expect(signature1).not.toBe(signature2);
  });
});

describe('verifyEd25519Signature', () => {
  it('should verify a valid signature', async () => {
    const message = 'verify test message';
    const signature: string = await signEd25519Message(message, TEST_SECRET_KEY_BASE64);
    const result: boolean = await verifyEd25519Signature({
      message,
      signature,
      secretKeyBase64: TEST_SECRET_KEY_BASE64,
    });
    expect(result).toBe(true);
  });

  it('should reject signature for wrong message', async () => {
    const signature: string = await signEd25519Message('original message', TEST_SECRET_KEY_BASE64);
    const result: boolean = await verifyEd25519Signature({
      message: 'different message',
      signature,
      secretKeyBase64: TEST_SECRET_KEY_BASE64,
    });
    expect(result).toBe(false);
  });

  it('should reject invalid signature', async () => {
    const invalidSignature: string = btoa('invalid signature data that is long enough');
    const result: boolean = await verifyEd25519Signature({
      message: 'test message',
      signature: invalidSignature,
      secretKeyBase64: TEST_SECRET_KEY_BASE64,
    });
    expect(result).toBe(false);
  });
});
