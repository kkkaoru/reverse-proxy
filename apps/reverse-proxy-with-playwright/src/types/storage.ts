// Storage state type definitions for browser session
// Execute with bun: wrangler dev

export interface StorageStateData {
  cookies: readonly CookieData[];
  origins: readonly OriginData[];
}

export interface CookieData {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: 'Strict' | 'Lax' | 'None';
}

export interface OriginData {
  origin: string;
  localStorage: readonly LocalStorageEntry[];
}

export interface LocalStorageEntry {
  name: string;
  value: string;
}
