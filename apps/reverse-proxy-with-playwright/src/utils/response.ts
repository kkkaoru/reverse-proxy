// Response utility functions
// Execute with bun: wrangler dev

import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { HTTP_STATUS_OK } from '../constants.ts';
import type { ErrorResponse, SuccessResponse } from '../types.ts';

export interface ErrorResponseParams {
  c: Context;
  error: string;
  message: string;
  statusCode: ContentfulStatusCode;
}

export const jsonResponse = <T>(
  c: Context,
  data: T,
  status: ContentfulStatusCode = HTTP_STATUS_OK,
): Response => c.json(data, status);

export const errorResponse = (params: ErrorResponseParams): Response => {
  const body: ErrorResponse = {
    error: params.error,
    message: params.message,
    statusCode: params.statusCode,
  };
  return jsonResponse(params.c, body, params.statusCode);
};

export const successResponse = (c: Context, message: string): Response => {
  const body: SuccessResponse = {
    success: true,
    message,
  };
  return jsonResponse(c, body, HTTP_STATUS_OK);
};

export const htmlResponse = (
  c: Context,
  html: string,
  status: ContentfulStatusCode = HTTP_STATUS_OK,
): Response => c.html(html, status);
