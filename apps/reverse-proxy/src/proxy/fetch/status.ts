// Fetch status utilities
// Execute with bun: wrangler dev

import {
  STATUS_CLIENT_ERROR_START,
  STATUS_REDIRECT_END,
  STATUS_REDIRECT_START,
} from '../constants.ts';

// Check if status is cacheable (below 400)
export const isCacheableStatus = (status: number): boolean => status < STATUS_CLIENT_ERROR_START;

// Check if status is a redirect (300-399)
export const isRedirectStatus = (status: number): boolean =>
  status >= STATUS_REDIRECT_START && status < STATUS_REDIRECT_END;
