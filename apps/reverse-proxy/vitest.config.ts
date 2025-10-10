// biome-ignore lint/correctness/noNodejsModules: Vitest configuration executes in Node.js, so built-ins are allowed here.
// biome-ignore lint/nursery/noUnresolvedImports: Node.js built-ins resolve at runtime within Vitest.
import { resolve } from 'node:path';
// biome-ignore lint/correctness/noNodejsModules: Vitest configuration executes in Node.js, so built-ins are allowed here.
// biome-ignore lint/nursery/noUnresolvedImports: Node.js built-ins resolve at runtime within Vitest.
import { fileURLToPath } from 'node:url';
// biome-ignore lint/nursery/noUnresolvedImports: Vitest exposes its config helper under this subpath.
import { defineConfig } from 'vitest/config';

const rootDir: string = fileURLToPath(new URL('.', import.meta.url));

// biome-ignore lint/style/noDefaultExport: Vitest CLI loads configuration via a default export.
export default defineConfig({
  root: rootDir,
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'lcov'],
      reportsDirectory: resolve(rootDir, 'coverage'),
    },
  },
});
