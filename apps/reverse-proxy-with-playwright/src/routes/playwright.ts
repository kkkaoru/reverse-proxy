// Playwright route for page scraping
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import {
  HTTP_STATUS_BAD_REQUEST,
  HTTP_STATUS_INTERNAL_SERVER_ERROR,
  HTTP_STATUS_NOT_FOUND,
} from '../constants/index.ts';
import { findSignInUserByDomainAndUserId } from '../repositories/sign-in-users.ts';
import { getCachedHtml, setCachedHtml } from '../services/cache.ts';
import { fetchPageWithSignIn } from '../services/signin.ts';
import type { WorkerBindings } from '../types/index.ts';
import { extractDomain } from '../utils/domain.ts';
import { errorResponse, htmlResponse } from '../utils/response.ts';

interface PlaywrightQueryParams {
  url: string;
  userId: string;
}

interface ValidatedParams {
  params: PlaywrightQueryParams;
  domain: string;
}

const QUERY_PARAM_URL = 'url';
const QUERY_PARAM_USER_ID = 'user_id';

const getQueryParams = (c: Context<{ Bindings: WorkerBindings }>): PlaywrightQueryParams | null => {
  const encodedUrl: string | undefined = c.req.query(QUERY_PARAM_URL);
  const encodedUserId: string | undefined = c.req.query(QUERY_PARAM_USER_ID);

  if (!(encodedUrl && encodedUserId)) {
    return null;
  }

  return { url: decodeURIComponent(encodedUrl), userId: decodeURIComponent(encodedUserId) };
};

const validateParams = (c: Context<{ Bindings: WorkerBindings }>): ValidatedParams | Response => {
  const params: PlaywrightQueryParams | null = getQueryParams(c);
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

export const playwrightHandler = async (
  c: Context<{ Bindings: WorkerBindings }>,
): Promise<Response> => {
  const paramsResult: PlaywrightQueryParams | null = getQueryParams(c);
  if (!paramsResult) {
    return errorResponse({
      c,
      error: 'Bad Request',
      message: 'Missing required parameters: url and user_id',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
  }

  const cachedData = await getCachedHtml({ url: paramsResult.url, userId: paramsResult.userId });
  if (cachedData) {
    return htmlResponse(c, cachedData.html);
  }

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

  const result = await fetchPageWithSignIn({
    browserWorker: c.env.BROWSER,
    db: c.env.DB,
    kv: c.env.KV,
    url: params.url,
    userId: params.userId,
    password: signInUser.passwordHash,
  });

  if (result.errorMessage) {
    return errorResponse({
      c,
      error: 'Internal Server Error',
      message: result.errorMessage,
      statusCode: HTTP_STATUS_INTERNAL_SERVER_ERROR,
    });
  }

  await setCachedHtml({ url: params.url, userId: params.userId }, result.html);
  return htmlResponse(c, result.html);
};

export const getQueryParamsForTest = (
  c: Context<{ Bindings: WorkerBindings }>,
): PlaywrightQueryParams | null => getQueryParams(c);
