// Auth middleware for Bearer token ED25519 verification
// Execute with bun: wrangler dev

import type { Context, Next } from 'hono';
import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_UNAUTHORIZED } from '../constants/index.ts';
import { verifyEd25519Signature } from '../crypto/ed25519.ts';
import { findSecretKeyByDomain } from '../repositories/secret-keys.ts';
import type { WorkerBindings } from '../types/index.ts';
import { extractDomain } from '../utils/domain.ts';
import { errorResponse } from '../utils/response.ts';

interface AuthResult {
  verified: boolean;
  domain: string;
  url: string;
  userId: string;
}

const BEARER_PREFIX = 'Bearer';
const BEARER_PARTS_COUNT = 2;
const BEARER_TOKEN_INDEX = 1;
const QUERY_PARAM_URL = 'url';
const QUERY_PARAM_USER_ID = 'user_id';
const AUTH_HEADER_NAME = 'Authorization';

const extractBearerToken = (authHeader: string | undefined): string | null => {
  if (!authHeader) {
    return null;
  }
  const parts: readonly string[] = authHeader.split(' ');
  if (parts.length !== BEARER_PARTS_COUNT || parts[0] !== BEARER_PREFIX) {
    return null;
  }
  return parts[BEARER_TOKEN_INDEX] ?? null;
};

const buildSignatureMessage = (url: string, userId: string): string => `${url}::${userId}`;

export const verifyBearerToken = async (
  c: Context<{ Bindings: WorkerBindings }>,
  url: string,
  userId: string,
): Promise<AuthResult> => {
  const domain: string = extractDomain(url);
  if (!domain) {
    return { verified: false, domain: '', url, userId };
  }

  const secretKey = await findSecretKeyByDomain(c.env.DB, domain);
  if (!secretKey) {
    return { verified: false, domain, url, userId };
  }

  const authHeader: string | undefined = c.req.header(AUTH_HEADER_NAME);
  const token: string | null = extractBearerToken(authHeader);
  if (!token) {
    return { verified: false, domain, url, userId };
  }

  const message: string = buildSignatureMessage(url, userId);
  const isValid: boolean = await verifyEd25519Signature({
    message,
    signature: token,
    secretKeyBase64: secretKey.secretKeyBase64,
  });

  return { verified: isValid, domain, url, userId };
};

export const authMiddleware = async (
  c: Context<{ Bindings: WorkerBindings }>,
  next: Next,
): Promise<Response | undefined> => {
  const encodedUrl: string | undefined = c.req.query(QUERY_PARAM_URL);
  const encodedUserId: string | undefined = c.req.query(QUERY_PARAM_USER_ID);

  if (!(encodedUrl && encodedUserId)) {
    return errorResponse({
      c,
      error: 'Bad Request',
      message: 'Missing required parameters: url and user_id',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
  }

  const url: string = decodeURIComponent(encodedUrl);
  const userId: string = decodeURIComponent(encodedUserId);

  const authResult: AuthResult = await verifyBearerToken(c, url, userId);

  if (!authResult.verified) {
    return errorResponse({
      c,
      error: 'Unauthorized',
      message: 'Invalid or missing authentication token',
      statusCode: HTTP_STATUS_UNAUTHORIZED,
    });
  }

  await next();
};

export const extractBearerTokenForTest = (authHeader: string | undefined): string | null =>
  extractBearerToken(authHeader);

export const buildSignatureMessageForTest = (url: string, userId: string): string =>
  buildSignatureMessage(url, userId);
