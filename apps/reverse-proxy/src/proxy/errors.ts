// Error utilities for proxy
// Execute with bun: wrangler dev

import { ERROR_UNKNOWN_FETCH } from './constants.ts';

// Error message extraction
export const getErrorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : ERROR_UNKNOWN_FETCH;
