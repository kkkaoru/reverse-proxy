// Entity type definitions for database models
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
