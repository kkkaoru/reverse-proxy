# Production rollout: Kitesurf migration

User authorization: deploy and verify production (2026-09-12 UTC).

## Scope and preservation

Targets: `reverse-proxy-queue`, `reverse-proxy-queue-a`, `reverse-proxy-queue-b`, and `reverse-proxy-with-playwright`. The unrelated `reverse-proxy` frontend is not modified. Proxy A owns the shared health Durable Object referenced by B.

Deploy through Executor/Cloudflare API. Existing bindings are inherited server-side, including credentials, KV/D1 and Durable Object identities. Preserve runtime limits, logging, placement and other existing settings. No endpoint uploads, D1 migrations, account creation, credential extraction, session KV writes or cache purges are performed. Public validation uses `disable_kv=true&disable_cache=true`.

Rollback versions captured before rollout:

| Worker | Original version |
| --- | --- |
| reverse-proxy-queue | 443bb3f1-7d33-456c-97dc-3fa606c32a2c |
| reverse-proxy-queue-a | a70018a4-a2db-4734-bf61-5596ed224f47 |
| reverse-proxy-queue-b | 2ccfe96a-0b2c-4a0d-b0e2-dae862707039 |
| reverse-proxy-with-playwright | 7f166bb0-6614-4179-a549-4c48db9bfe8a |

The upload API accepts only `inherit.version_id = "latest"`, despite the schema describing explicit IDs. Preflight checks the active version, and postflight checks every preserved binding without printing values.

## Canary discovery and rollback

The first successful canary was `804c377a-c424-4220-ab78-3ffa9212820e` on the single Worker. All 13 existing bindings were preserved. Example, DB, NAR result and unlisted example.org checks passed, but NAR/race roots returned incomplete content. Expansion to A/B was stopped and the single Worker was rolled back to its original version; the API confirmed that version at 100%.

The untouched A Worker reproduced both failures:

- NAR root: an Apache-style `<title>302 Found</title>` / `The document has moved` interstitial.
- Race root: only `<script>window.location.href = "/top/";</script>`.

These came from the existing earlier IP-rotation path, before either browser engine ran. Added `navigation-stub.ts` and core regression tests to reject those interstitials and continue to the browser path. Real page content containing unrelated navigation scripts remains accepted. This preserves the order of cache/IP-rotation/browser operations while correcting what counts as usable IP-rotation content.

## Successful rollout and production checks

After the fix, typecheck/lint, **1,003 proxy + 245 authenticated + 218 IP-rotate = 1,466 tests**, and the production build passed. Targeted coverage: core 99.43% lines / 90.09% branches; Kitesurf 100% lines / 97.75% branches; navigation-stub detector fully covered.

The repaired single-Worker canary passed, then A passed before B was deployed. Authenticated Worker deployment was independent of the A/B Durable Object order.

| Worker | Deployed version | Existing bindings verified preserved |
| --- | --- | --- |
| reverse-proxy-queue | bb7b4d34-f480-4d50-911c-1fc682e64bf4 | 13 |
| reverse-proxy-queue-a | 81c1c676-93e6-443f-ab32-1ef089966dbc | 14 |
| reverse-proxy-queue-b | f41a27c3-5c53-457f-b849-531f9b1ac36c | 14 |
| reverse-proxy-with-playwright | 606ee2fa-27ec-48ed-9369-be23bdde1c39 | 4, including PEPPER |

All **18 public requests** passed (six URLs through each of the single/A/B production hosts): example.com, NAR root, race root, DB root, the exact NAR result URL, and unlisted example.org. Each returned HTTP 200, `x-cache: MISS`, UTF-8 HTML and every required body marker. NAR/race now return complete rendered pages instead of redirect stubs. Observed individual durations were approximately 1–5.5 seconds, not a performance guarantee.

Authenticated Worker checks: health 200, missing-parameter validation 400 before rollout, and missing-signature rejection 401 both before and after rollout. No valid user session was used.

Do not interpret HTTP 200 alone as success: the public checks validate required body content. Successful routing does not independently identify the serving engine when IP rotation can satisfy the request first. These checks are not a live chaos test of every Kitesurf failure mode; fallback failure conditions are covered by the automated suite.

Final read-only API audit passed for all four Workers: expected versions at 100% traffic, compatibility dates and exact Kitesurf rules matched. Binding totals are 14/15/15/4 (the three proxies each gained only KITESURF_HTML_RULES). Custom domains still map A→reverse-proxy-queue-a and B→reverse-proxy-queue-b.

Real-account authenticated login/refresh is not performed without an authorized test account/signature. Authenticated Worker smoke checks are limited to health, request validation and authentication rejection; synthetic browser capability results are in `kitesurf-phase2.md`.

Local rollout artifacts and receipts: `/tmp/kitesurf-production/`. API tokens and production credential values are not included.
