// Batch single URL fetch
// Execute with bun: wrangler dev

import { convertResponseToUtf8 } from '../../../utils/encoding.ts';
import {
  ERROR_FETCH_FAILED,
  RESULT_ERROR,
  RESULT_SSRF_BLOCKED,
  RESULT_SUCCESS,
  STATUS_BAD_GATEWAY,
  STATUS_CLIENT_ERROR_START,
  STATUS_UNPROCESSABLE_ENTITY,
} from '../../constants.ts';
import { performFetch } from '../../fetch/core.ts';
import { buildFetchHeaders } from '../../fetch/headers.ts';
import type {
  BatchFetchResult,
  BatchResultStatus,
  SingleFetchParams,
  SsrfValidationResult,
} from '../../types.ts';
import { validateUrlWithSsrf } from '../../url.ts';

// Fetch single URL with SSRF validation
export const fetchSingleUrl = async (params: SingleFetchParams): Promise<BatchFetchResult> => {
  const validation: SsrfValidationResult = validateUrlWithSsrf(params.url);

  if (!validation.valid) {
    return {
      url: params.url,
      httpStatus: STATUS_UNPROCESSABLE_ENTITY,
      result: RESULT_SSRF_BLOCKED,
      body: validation.reason,
    };
  }

  const headers: Record<string, string> = buildFetchHeaders(validation.url.origin);

  try {
    const response: Response = await performFetch(params.options, params.url, headers);
    const converted: Response = await convertResponseToUtf8(response);
    const body: string = await converted.text();
    const result: BatchResultStatus =
      response.status < STATUS_CLIENT_ERROR_START ? RESULT_SUCCESS : RESULT_ERROR;
    return { url: params.url, httpStatus: response.status, result, body };
  } catch {
    return {
      url: params.url,
      httpStatus: STATUS_BAD_GATEWAY,
      result: RESULT_ERROR,
      body: ERROR_FETCH_FAILED,
    };
  }
};
