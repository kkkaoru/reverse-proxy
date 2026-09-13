# Kitesurf capability verification beyond public homepages

## Scope and engine proof

Live synthetic tests used only dummy credentials and isolated Workers, with Chromium controls. No production KV/D1 or real account session was read or written.

`@cloudflare/playwright` 1.3.6 officially supports `launch(binding, { browser: 'kitesurf' })`. It uses a sessionless `/v1/devtools/browser?browser=kitesurf` WebSocket and plain JSON transport. The same endpoint with `browser=invalid-engine` returned **400, expected "kitesurf"**; the valid selection returned **101** and browser version **145.0.0.0**. Chromium reported **128.0.6613.137**. This is verified selection, unlike the earlier legacy acquire-query experiment.

## Results

| Operation | Kitesurf result | Chromium control / migration decision |
| --- | --- | --- |
| Launch, newContext, newPage, goto | Passed | Does not establish full workflow compatibility |
| Form fill | Both dummy input fields accepted fill calls | Ordinary submission still fails |
| Ordinary page.click | Visible/enabled/stable checks pass, then click reports element not visible until timeout | Chromium login succeeds; keep current signin on Playwright |
| JavaScript-delayed button click | evaluate returns, but signed-in element never attaches | Not a proven replacement for click |
| Quick Action script submission | Immediate and deferred variants fail with navigation generation-bump errors | Chromium deferred submission succeeds |
| HttpOnly Cookie input | Quick Action and CDP authenticate the protected fixture; document.cookie remains empty | Proven primitive, not complete auth compatibility |
| localStorage in current page | Write/read of `persisted` succeeds | Not equivalent to storageState support |
| storageState export | Fails: localStorage value expected string, got object | Chromium exports Cookie and localStorage successfully |
| storageState restore into a fresh browser | Independently seeded valid Cookie/localStorage state fails with undefined IndexedDB.databases, even without IndexedDB state | Chromium new-context restoration passes; do not migrate persisted auth state |
| Cookie expiry (Max-Age=0 followed by redirect) | Quick Action and CDP still authenticate; CDP retains one Cookie | Chromium returns signed-out/401; keep expiry/re-login flow on Playwright |
| Actual cross-subdomain Cookie transmission | Passed: unauthenticated peer negative control, server-issued Domain Cookie, redirect to peer, return to original host | Both engines pass; actual network test, not just Cookie-jar matching |
| Locale/timezone/User-Agent options | Requested ja-JP, Asia/Tokyo, FixtureProbe/1.0; observed en-US, UTC, Cloudflare-Workers | Chromium honors all three; auth context requirements are not equivalent |
| page.content | Throws a Kitesurf callable-function error | document.documentElement.outerHTML evaluation works as a probe workaround; current API is not a drop-in replacement |
| Non-HTML response.text | Origin status/content-type retained, but text/plain becomes pre HTML and JSON becomes JSON-viewer HTML | Chromium returns exact original Japanese text/JSON and 201/202; retain Playwright for raw-response semantics |
| browser.close | Did not resolve within the probe's 12-second deadline | Probe explicitly closes its owned WebSockets; production CDP migration would need verified lifecycle handling |

The authentication lifecycle is **not currently eligible** for migration, despite working Cookie transmission. Trying Kitesurf first on that known-incompatible flow would add delay and risk incorrect state. Real netkeiba login, premium data completeness, and real expiry/re-login remain unverified and need an authorized test account plus isolated state; synthetic failures are not claims about every possible custom Kitesurf implementation.

## SDK and fallback

The original 1.1.0 SDK timed out in the isolated current-date Chromium fixture. Version 1.3.6 uses a different supported CDP endpoint/transport and passed the Chromium control. The repository dependency and lockfile are now upgraded to **1.3.6** to support the verified fallback path. This does not switch authenticated operations to Kitesurf.

After upgrading: root typecheck/lint, **988 proxy + 245 authenticated + 218 IP-rotate = 1,451 tests**, and diff whitespace checks passed. Both Worker dry-run builds also passed. After the multi-marker rule addition, final verification also passed: typecheck/lint, **994 + 245 + 218 = 1,457 tests**, the proxy dry-run rebuild and diff checks. Kitesurf's **45 tests** achieve 100% statement/line/function and **97.67% branch coverage**. Existing user locale/timezone changes are preserved.

## Additional real URLs

Anonymous comparisons are recorded separately from authenticated compatibility. In particular, the fixture URL `https://nar.netkeiba.com/race/data_top.html?race_id=202635070601` returns the same expired-analysis notice on both engines: data is available only from the preceding day through two days after the race. This does **not** prove the actual analysis payload or premium data is available through Kitesurf. Do not widen authenticated URL handling from this result.

Additional URL findings:

- `race.netkeiba.com/race/data_top.html` returns `empty paramter(race_id)` on both engines; not a valid data-page qualification.
- `regist.netkeiba.com/account/login.html` returns 404 on both engines; this example does not establish the configured real login URL.
- `nar.netkeiba.com/race/result.html?race_id=202635070601` passed: both engines returned 200, identical titles and identical 1,600-character normalized body prefixes containing all ten runners and payouts. Added as the fifth exact public rule with **all** of `レーニス`, `アストラアヴィス`, `9,360円` required. Other IDs and authenticated analysis pages are not generalized from it.
- Multi-marker arrays reject empty/mixed/blank entries and fall back if any marker occurs only in a script or is absent. Regression tests cover the additional rule and a different race ID.

## Probe reliability and cleanup

- Sources and bounded streaming diagnostics: `/tmp/kitesurf-phase2/`.
- Temporary main Worker: `kitesurf-phase2-1789239086451` (Browser binding only).
- Temporary cross-domain peer: `kitesurf-phase2-1789239086451-peer` (no bindings).
- Latest synthetic tests emit operation start/result, bound individual operations, and explicitly close owned WebSockets even when browser.close stalls.
- Before deletion, binding session inspection returned `activeSessionCount: 0` and `ownActiveIds: []`. Both temporary Workers were then deleted successfully through Executor; a successful Worker listing returned `remaining: []`. Sessionless probe connections were explicitly closed locally; there are no temporary Workers left.
- Initial expiry-calculation failures, shell-quoting-damaged scripts, wrong legacy framing, requests hitting an older deployment, and truncated API output are excluded from compatibility conclusions. Updates now use a version readiness check; scripts pass JSON as argv rather than shell-quoted code.
- API MCP public CDP requests surfaced `Cloudflare API error: 200`; those responses did not establish selection or cleanup. The successful binding/CDP controls supersede that inconclusive route.
- These isolated probes did not deploy production. The user subsequently authorized production rollout; see `kitesurf-production-rollout.md` for deployed versions, 18 successful public checks and the additional IP-rotation redirect-stub fix (final suite: 1,466 tests).
