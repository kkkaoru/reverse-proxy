// Proxy response creators
// Execute with bun: wrangler dev

import { CONTENT_TYPE_JSON, HEADER_CONTENT_TYPE } from './constants.ts';

// Response creators
export const createJsonResponse = (payload: unknown, status: number): Response =>
  new Response(JSON.stringify(payload), {
    status,
    headers: { [HEADER_CONTENT_TYPE]: CONTENT_TYPE_JSON },
  });

export const createErrorResponse = (message: string, status: number): Response =>
  createJsonResponse({ error: message }, status);
