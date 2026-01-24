// UUID7 generation utility
// Execute with bun: wrangler dev

import { HEX_BASE } from '../constants.ts';

const UUID7_VERSION: number = 0x7000;
const UUID7_VARIANT: number = 0x8000;
const VARIANT_MASK: number = 0x3fff;
const RANDOM_A_MASK: number = 0x0fff;
const MS_HI_DIVISOR: number = 0x10000;
const MS_LO_MASK: number = 0xffff;
const PART1_LENGTH: number = 8;
const PART2_LENGTH: number = 4;
const RANDOM_ARRAY_SIZE: number = 3;
const UUID7_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const toHex = (n: number, len: number): string => n.toString(HEX_BASE).padStart(len, '0');

export const generateUuid7 = (): string => {
  const timestamp: number = Date.now();
  const msHi: number = Math.floor(timestamp / MS_HI_DIVISOR);
  const msLo: number = timestamp & MS_LO_MASK;
  const randomA: number = (crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) & RANDOM_A_MASK;
  const randomB: number =
    ((crypto.getRandomValues(new Uint16Array(1))[0] ?? 0) & VARIANT_MASK) | UUID7_VARIANT;
  const randomC: Uint16Array = crypto.getRandomValues(new Uint16Array(RANDOM_ARRAY_SIZE));

  const part1: string = toHex(msHi, PART1_LENGTH);
  const part2: string = toHex(msLo, PART2_LENGTH);
  const part3: string = toHex(UUID7_VERSION | randomA, PART2_LENGTH);
  const part4: string = toHex(randomB, PART2_LENGTH);
  const part5: string = `${toHex(randomC[0] ?? 0, PART2_LENGTH)}${toHex(randomC[1] ?? 0, PART2_LENGTH)}${toHex(randomC[2] ?? 0, PART2_LENGTH)}`;

  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
};

export const isValidUuid7 = (uuid: string): boolean => UUID7_REGEX.test(uuid);
