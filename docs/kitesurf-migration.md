# Kitesurf migration verification

## Status

Repository implementation: verified public HTML operations are individually configured to use Kitesurf through the existing Browser binding. Other operations go directly to Playwright. A compatible Kitesurf operation falls back to the original Playwright retry path if its attempt fails validation, times out, or encounters a service error.

**This is not a claim that every possible proxy URL or authenticated workflow is verified.** The single/A/B proxies and authenticated Worker have now been deployed with preserved bindings; 18 public production checks passed. See [production rollout and rollback evidence](kitesurf-production-rollout.md). Authenticated flows remain Playwright-only: phase-two synthetic tests identified state export/restore, Cookie expiry, context-option and click incompatibilities. See [the capability matrix](kitesurf-phase2.md); an account alone would not resolve these differences.

## Verified configuration

Main, primary and secondary proxy configurations use compatibility date `2026-03-24`, required for `BROWSER.quickAction`. The authenticated Worker's date is unchanged.

| Exact public URL | Wait condition | Required body text |
| --- | --- | --- |
| https://example.com/ | domcontentloaded | Example Domain |
| https://nar.netkeiba.com/ | domcontentloaded | 開催レース一覧 |
| https://race.netkeiba.com/ | networkidle2 | 開催レース一覧 |
| https://db.netkeiba.com/ | networkidle2 | みんなの競走馬ランキング |
| https://nar.netkeiba.com/race/result.html?race_id=202635070601 | networkidle2 | All: レーニス, アストラアヴィス, 9,360円 |

`KITESURF_HTML_RULES` is a JSON object. Each value is either a required text string (domcontentloaded) or `{ "text": "...", "waitUntil": "networkidle2" }`. Object-form `text` may also be a nonempty array of nonblank strings; **every** marker must appear in the body, excluding scripts/styles/comments. Empty rules disable Kitesurf. Unknown URLs, unsupported schemes/credentials and known incompatible URL/wait combinations skip Kitesurf entirely. Rules are exact URLs, not permission to migrate all paths on a domain.

The repository accepts arbitrary proxy URLs; a finite test set cannot establish universal site compatibility. Expand rules only after comparing the actual content needed by the caller. A common navigation/title marker alone is not evidence of full-page parity.

## Live evidence via Executor / Cloudflare MCP

Cloudflare Docs MCP and API MCP were used for documentation, API schema discovery, public-page probes, and an isolated temporary Worker. API calls specified `browser=kitesurf` and disabled the Quick Action cache. Individual REST responses do not independently attest the engine identity.

The temporary Worker established the actual binding API:

```js
await env.BROWSER.quickAction('content', {
  browser: 'kitesurf',
  cacheTTL: 0,
  url,
  gotoOptions: { waitUntil: 'networkidle2', timeout: 15000 },
});
```

Negative controls:

- `browser: 'invalid-engine'` in the second argument returns 400, with `expected "kitesurf"`.
- Passing browser in a third argument is ignored: even an invalid engine succeeds. Do not use this form.
- `quickAction('content?browser=kitesurf', ...)` is rejected as an invalid action.
- `cacheTTL: -1` returns 400; zero succeeds. The implementation disables this cache to preserve caller cache-bypass semantics.

The **production wrapper module itself**, bundled into the isolated Worker with no API token, returned the following without invoking its fallback callback:

| URL | Origin status | HTML characters | One-run elapsed time |
| --- | --- | --- | --- |
| example.com/ | 200 | 544 | 1968 ms |
| nar.netkeiba.com/ | 200 | 69598 | 4502 ms |
| race.netkeiba.com/ | 200 | 114573 | 4516 ms |
| db.netkeiba.com/ | 200 | 112484 | 5540 ms |

These are single-run observations, not performance guarantees or full DOM equality measurements.

Phase two additionally compared the exact NAR result URL above: both engines returned 200 and identical titles and 1,600-character normalized body prefixes, covering all ten runners and payouts. Kitesurf returned 80,511 HTML characters; Chromium returned 322,741, including additional non-result content. This is main-result-content evidence, not full DOM parity. The rule requires the first and last runners plus the 9,360円 payout. Other race IDs remain unlisted.

Important compatibility findings:

- Japanese DOM text written by JavaScript worked in both engines on synthetic HTML.
- Race root with domcontentloaded returned only an 89-character JavaScript redirect stub. With networkidle2 it rendered the race page. This is a wait-mode constraint, **not an inherent inability to redirect**. A misconfigured early-wait rule routes directly to Playwright.
- DB root with domcontentloaded missed a dynamically loaded horse ranking. With networkidle2, both engines included the tested ranking entries. Japanese text decoded without replacement characters; Chromium reports an EUC-JP origin.
- NAR compared text excerpts matched, including featured races/odds and venue listings. Full dynamic DOM equality is not asserted.
- Unrelated JavaScript navigation handlers exist on valid pages. Their presence alone must not trigger fallback.
- Kitesurf meta contains origin status/title but may omit origin headers/final URL. The wrapper validates the origin status, never substitutes the API status, and returns rendered HTML as UTF-8. Non-HTML operations are not enabled.

Temporary Worker `kitesurf-probe-1789236545421` was deleted through Executor (HTTP 200), and a subsequent Worker listing confirmed it absent. It had no production KV, D1 or credentials. During that initial isolated verification phase, no production Worker configuration or state was changed remotely; the later authorized rollout is documented separately.

## Implementation

- `apps/reverse-proxy/src/playwright/kitesurf.ts`: rule selection, binding-first transport, validation and bounded fallback.
- `apps/reverse-proxy/src/playwright/handler.ts`: invokes the wrapper at the existing browser callback, after KV cache/IP-rotation handling.
- `kitesurf.test.ts`: transport, routing, payload validation, timeout and late-response cleanup tests.
- `handler.test.ts`: actual handler integration; only remote Playwright launch is mocked.

Kitesurf gets one attempt with a 15-second caller deadline. Binding RPC cannot be force-canceled; late response bodies are canceled and do not cause another response or fallback. The existing Chromium retry behavior remains unchanged. No authentication cookies, passwords or storage state are forwarded to Kitesurf.

Body validation rejects empty/incomplete HTML, script/title-only matches, challenge pages, meta-refresh pages and encoding corruption. Explicit unknown/invalid origin statuses also fall back. Successful content follows existing cache behavior. Use cache bypass for runtime validation so old Chromium cache entries do not mask engine selection.

No new API Secret is needed on the updated Browser binding. Optional REST transport remains available for environments without quickAction, using `KITESURF_ACCOUNT_ID` and a `KITESURF_API_TOKEN` Worker Secret. Never extract MCP OAuth tokens or commit credentials.

## Verification

Baseline: 945 proxy + 245 authenticated tests passed, root TypeScript/lint passed. IP-rotate initially had one failing multi-region fixture; the test now explicitly sets its two REGIONS and restores the environment. Production AWS behavior is unchanged; all 218 IP-rotate tests pass.

Phase-one verification passed: root TypeScript and Biome checks; 988 proxy + 245 authenticated + 218 IP-rotate tests (1451 total); both Workers' Wrangler deploy --dry-run builds; git diff --check. The proxy suite includes four actual-handler integration tests. The 39-test Kitesurf module suite measured 100% statement/line/function coverage and 97.4% branch coverage. Production deployment and authenticated live-site compatibility are not implied by these checks.

Phase-two final verification (SDK 1.3.6 and five exact URL rules): root TypeScript/Biome, **994 proxy + 245 authenticated + 218 IP-rotate = 1,457 tests**, both Worker dry-run builds, and `git diff --check` passed. The 45-test Kitesurf suite has 100% statement/line/function coverage and 97.67% branch coverage. See [phase-two results](kitesurf-phase2.md) for independently tested unsupported operations and cleanup evidence.

Existing user locale/timezone changes in authenticated browser code/tests have been preserved.

## Remaining gates

1. Production rollout and the listed post-deploy checks have passed. Other callers/URL families still need their own content checks. Clearing `KITESURF_HTML_RULES` disables Kitesurf; saved pre-rollout versions are documented for full rollback.
2. Authentication migration requires fixes/workarounds for the independently demonstrated API incompatibilities, then an authorized test account and representative protected URLs in isolated state. Do not use or overwrite production session KV. Cross-subdomain Cookie transmission alone passed, but it does not establish full authentication compatibility.
3. Other public URL families need representative targets and content assertions. Unknown capability means Playwright, not blind Kitesurf attempts.

## Official sources

- https://developers.cloudflare.com/browser-run/kitesurf/
- https://developers.cloudflare.com/browser-run/quick-actions/
- https://developers.cloudflare.com/browser-run/quick-actions/content-endpoint/
- https://developers.cloudflare.com/browser-run/cdp/playwright/
