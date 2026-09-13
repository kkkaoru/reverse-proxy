// biome-ignore-all lint/nursery/noSecrets: Literal public HTML fixtures contain no credentials.
// Execute with bun run test.
import { expect, it } from 'vitest';
import { isNavigationStub } from './navigation-stub.ts';

it('rejects the observed NAR HTTP redirect interstitial', () => {
  expect(
    isNavigationStub(
      '<html><head><title>302 Found</title></head><body><h1>Found</h1><p>The document has moved <a href="https://nar.netkeiba.com/top/">here</a>.</p></body></html>',
    ),
  ).toBe(true);
});

it('rejects the observed race JavaScript-only redirect', () => {
  expect(isNavigationStub('<script>\nwindow.location.href = "/top/";\n</script>')).toBe(true);
});

it('rejects script-only location replacement with a document skeleton', () => {
  expect(
    isNavigationStub(
      '<!doctype html><html><head><title>Redirect</title></head><body><script>location.replace("/top/")</script></body></html>',
    ),
  ).toBe(true);
});

it('keeps actual page content with unrelated navigation code', () => {
  expect(
    isNavigationStub(
      '<body>Race results<script>function go(){location.href="/top/"}</script></body>',
    ),
  ).toBe(false);
});

it('keeps ordinary found text without a redirect title', () => {
  expect(
    isNavigationStub('<title>Help</title><body>The document has moved in this example.</body>'),
  ).toBe(false);
});

it('keeps ordinary content even when its title mentions a status', () => {
  expect(isNavigationStub('<title>302 Found</title><body>Status documentation</body>')).toBe(false);
});

it('does not classify raw JavaScript as an HTML navigation stub', () => {
  expect(isNavigationStub('window.location.href = "/top/";')).toBe(false);
});
