// Tests for response utility functions
// Execute with bun: bunx vitest run

import { describe, expect, it } from 'vitest';
import { HTTP_STATUS_BAD_REQUEST, HTTP_STATUS_OK } from '../../src/constants.ts';
import {
  errorResponse,
  htmlResponse,
  jsonResponse,
  successResponse,
} from '../../src/utils/response.ts';
import { createMockContext } from '../helpers.ts';

describe('jsonResponse', () => {
  it('should create JSON response with default status', () => {
    const ctx = createMockContext();
    const data = { message: 'test' };
    const response: Response = jsonResponse(ctx, data);
    expect(response.status).toBe(200);
  });

  it('should create JSON response with custom status', () => {
    const ctx = createMockContext();
    const data = { message: 'test' };
    const response: Response = jsonResponse(ctx, data, HTTP_STATUS_BAD_REQUEST);
    expect(response.status).toBe(400);
  });

  it('should call context json method', () => {
    const ctx = createMockContext();
    const data = { message: 'test' };
    jsonResponse(ctx, data);
    expect(ctx.json).toHaveBeenCalledWith(data, HTTP_STATUS_OK);
  });
});

describe('errorResponse', () => {
  it('should create error response with correct body', () => {
    const ctx = createMockContext();
    const response: Response = errorResponse({
      c: ctx,
      error: 'TestError',
      message: 'Test error message',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
    expect(response.status).toBe(400);
  });

  it('should include error details in response body', () => {
    const ctx = createMockContext();
    errorResponse({
      c: ctx,
      error: 'ValidationError',
      message: 'Invalid input',
      statusCode: HTTP_STATUS_BAD_REQUEST,
    });
    expect(ctx.json).toHaveBeenCalledWith(
      {
        error: 'ValidationError',
        message: 'Invalid input',
        statusCode: 400,
      },
      HTTP_STATUS_BAD_REQUEST,
    );
  });
});

describe('successResponse', () => {
  it('should create success response with 200 status', () => {
    const ctx = createMockContext();
    const response: Response = successResponse(ctx, 'Operation completed');
    expect(response.status).toBe(200);
  });

  it('should include success flag and message', () => {
    const ctx = createMockContext();
    successResponse(ctx, 'Data saved successfully');
    expect(ctx.json).toHaveBeenCalledWith(
      {
        success: true,
        message: 'Data saved successfully',
      },
      HTTP_STATUS_OK,
    );
  });
});

describe('htmlResponse', () => {
  it('should create HTML response with default status', () => {
    const ctx = createMockContext();
    const html = '<html><body>Test</body></html>';
    const response: Response = htmlResponse(ctx, html);
    expect(response.status).toBe(200);
  });

  it('should create HTML response with custom status', () => {
    const ctx = createMockContext();
    const html = '<html><body>Error</body></html>';
    const response: Response = htmlResponse(ctx, html, HTTP_STATUS_BAD_REQUEST);
    expect(response.status).toBe(400);
  });

  it('should call context html method', () => {
    const ctx = createMockContext();
    const html = '<html><body>Content</body></html>';
    htmlResponse(ctx, html);
    expect(ctx.html).toHaveBeenCalledWith(html, HTTP_STATUS_OK);
  });
});
