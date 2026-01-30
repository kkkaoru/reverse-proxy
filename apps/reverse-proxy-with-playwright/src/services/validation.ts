// Validation service for sign-in state checking
// Execute with bun: wrangler dev

import type { BrowserContext, Page } from '@cloudflare/playwright';
import {
  BROWSER_DEFAULT_TIMEOUT_MS,
  BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
} from '../constants/index.ts';

interface ValidationParams {
  page: Page;
  textSelector: string;
  isSignedInRegexPattern: string;
}

interface ValidationResult {
  isSignedIn: boolean;
  matchedText?: string;
}

export const validateSignedInState = async (
  params: ValidationParams,
): Promise<ValidationResult> => {
  try {
    const element = await params.page.$(params.textSelector);
    if (!element) {
      return { isSignedIn: false };
    }

    const textContent = await element.textContent();
    if (!textContent) {
      return { isSignedIn: false };
    }

    const pattern = new RegExp(params.isSignedInRegexPattern);
    const isMatch = pattern.test(textContent);

    if (isMatch) {
      return { isSignedIn: true, matchedText: textContent };
    }

    return { isSignedIn: false };
  } catch {
    return { isSignedIn: false };
  }
};

interface CheckSignedInParams {
  context: BrowserContext;
  url: string;
  textSelector: string;
  isSignedInRegexPattern: string;
}

export const checkSignedIn = async (params: CheckSignedInParams): Promise<ValidationResult> => {
  const page = await params.context.newPage();

  try {
    await page.goto(params.url, {
      waitUntil: BROWSER_WAIT_UNTIL_DOMCONTENTLOADED,
      timeout: BROWSER_DEFAULT_TIMEOUT_MS,
    });

    const result = await validateSignedInState({
      page,
      textSelector: params.textSelector,
      isSignedInRegexPattern: params.isSignedInRegexPattern,
    });

    await page.close();
    return result;
  } catch {
    await page.close();
    return { isSignedIn: false };
  }
};
