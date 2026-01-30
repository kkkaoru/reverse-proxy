// API response type definitions
// Execute with bun: wrangler dev

export interface HealthcheckResponse {
  status: string;
  timestamp: string;
  service: string;
}

export interface ErrorResponse {
  error: string;
  message: string;
  statusCode: number;
}

export interface SuccessResponse {
  success: boolean;
  message: string;
}

export interface PlaywrightResponse {
  html: string;
  url: string;
  cached: boolean;
}
