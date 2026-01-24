// Playwright signin route for explicit sign-in
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
} from '../constants.ts';
import type { WorkerBindings } from '../global.d.ts';
import { findSignInUserByDomainAndUserId } from '../repositories/sign-in-users.ts';
import { executeSignInFlow } from '../services/signin.ts';
import { extractDomain } from '../utils/domain.ts';
import { errorResponse, jsonResponse } from '../utils/response.ts';

interface SignInQueryParams {
  url: string;
  userId: string;
}

interface SignInSuccessResponse {
  success: true;
  message: string;
  domain: string;
  userId: string;
}

interface ValidatedParams {
  params: SignInQueryParams;
  domain: string;
}

const QUERY_PARAM_URL = 'url';
const QUERY_PARAM_USER_ID = 'user_id';

const getQueryParams = (c: Context<{ Bindings: WorkerBindings }>): SignInQueryParams | null => {
  const encodedUrl: string | undefined = c.req.query(QUERY_PARAM_URL);
  const encodedUserId: string | undefined = c.req.query(QUERY_PARAM_USER_ID);

  if (!(encodedUrl && encodedUserId)) {
    return null;
  }

  return { url: decodeURIComponent(encodedUrl), userId: decodeURIComponent(encodedUserId) };
};

const validateParams = (c: Context<{ Bindings: WorkerBindings }>): ValidatedParams | Response => {
  const params: SignInQueryParams | null = getQueryParams(c);
  if (!params) {
    return errorResponse({
      c,
      error: 'Bad Request',
      message: 'Missing required parameters: url and user_id',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
  }

  const domain: string = extractDomain(params.url);
  if (!domain) {
    return errorResponse({
      c,
      error: 'Bad Request',
      message: 'Invalid URL provided',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
  }

  return { params, domain };
};

export const playwrightSignInHandler = async (
  c: Context<{ Bindings: WorkerBindings }>,
): Promise<Response> => {
  const validation: ValidatedParams | Response = validateParams(c);
  if (validation instanceof Response) {
    return validation;
  }

  const { params, domain } = validation;
  const signInUser = await findSignInUserByDomainAndUserId(c.env.DB, domain, params.userId);

  if (!signInUser) {
    return errorResponse({
      c,
      error: 'Not Found',
      message: 'Sign-in user not found for this domain and user ID',
      statusCode: HTTP_STATUS_NOT_FOUND,
    });
  }

  const result = await executeSignInFlow({
    browserWorker: c.env.BROWSER,
    db: c.env.DB,
    kv: c.env.KV,
    domain,
    userId: params.userId,
    password: signInUser.passwordHash,
  });

  if (!result.success) {
    return errorResponse({
      c,
      error: 'Internal Server Error',
      message: result.errorMessage ?? 'Sign-in failed',
      statusCode: HTTP_STATUS_INTERNAL_SERVER_ERROR,
    });
  }

  return jsonResponse(c, {
    success: true,
    message: 'Sign-in completed successfully',
    domain,
    userId: params.userId,
  } satisfies SignInSuccessResponse);
};

export const getQueryParamsForTest = (
  c: Context<{ Bindings: WorkerBindings }>,
): SignInQueryParams | null => getQueryParams(c);
