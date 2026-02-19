// Tests for playwright route registration
// Execute with bun: bunx vitest run

import { expect, test } from 'vitest';
import { PLAYWRIGHT_PATH } from './playwright.ts';

test('PLAYWRIGHT_PATH is /playwright', () => {
  expect(PLAYWRIGHT_PATH).toBe('/playwright');
});
