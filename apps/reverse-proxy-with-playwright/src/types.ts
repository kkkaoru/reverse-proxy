// Type definitions for reverse-proxy-with-playwright
// Execute with bun: wrangler dev

export interface SignInSelector {
  id: string;
  domain: string;
  signInUrl: string;
  userIdSelector: string;
  passwordSelector: string;
  signInButtonSelector: string;
  createdAt: string;
  updatedAt: string;
}

export interface SecretKey {
  id: string;
  domain: string;
  secretKeyBase64: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignedInValidationRegex {
  id: string;
  domain: string;
  textSelector: string;
  isSignedInRegexPattern: string;
  createdAt: string;
  updatedAt: string;
}

export interface SignInUser {
  id: string;
  domain: string;
  userId: string;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthcheckResponse {
  status: string;
  timestamp: string;
  service: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

export interface SuccessResponse {
  success: boolean;
  message: string;
}

export interface PlaywrightResponse {
  html: string;
  url: string;
  cached: boolean;
}

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
