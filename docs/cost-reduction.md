# Cost reduction (2026-10)

## 1. Load balancer health checks

Before this change, each `GET /healthcheck` probe from `Cloudflare-Traffic-Manager` was a billed Worker request. With `interval: 60` probing from every region, `reverse-proxy-queue-a` and `reverse-proxy-queue-b` each received about 1.06M probes a day. That came to about 2.2M requests a day, or roughly $16-19 a month.

`apps/reverse-proxy/scripts/setup-load-balancer.sh` now does the following:

- Sets the monitor `interval` to 300s. Override it with `LB_MONITOR_INTERVAL` in `.dev.vars`.
- Sets the pool `check_regions` to a single region, `NEAS`. Override it with `LB_CHECK_REGION`. The workers.dev origins run in every colo, so there is no origin region. NEAS is closest to the callers and to the netkeiba upstream in Japan.
- Updates (PATCHes) the existing monitor, matched by description, and the existing pool, matched by name. Before, a rerun only reused them, so new settings never reached the live LB.

The `/healthcheck` handler no longer calls `console.log`. It has never touched KV, D1 or the browser: the proxy middleware is mounted on `/` only.

Apply the change from this worktree, not from a checkout with unrelated uncommitted changes. `.dev.vars` is gitignored, so copy it in first. The script reads `CLOUDFLARE_API_TOKEN_LB` from it.

```sh
cp ../reverse-proxy/apps/reverse-proxy/.dev.vars apps/reverse-proxy/
cd apps/reverse-proxy && bun run lb:setup
```

Before relying on the savings, run this read-only check. One monitor at 60s from all regions should be about 13 regions x a few probers x 1,440, which is tens of thousands of probes per day. The observed 1.06M per origin is much higher. That points to duplicate pools or monitors from earlier POST-only runs, or a zone Health Check. The script updates only the first match.

```sh
set -a; source apps/reverse-proxy/.dev.vars; set +a
H="Authorization: Bearer $CLOUDFLARE_API_TOKEN_LB"; A="https://api.cloudflare.com/client/v4"
curl -sS -H "$H" "$A/accounts/$CLOUDFLARE_ACCOUNT_ID/load_balancers/pools" \
  | jq '.result[] | select(any(.origins[]; .address|test("workers.dev"))) | {id, name, monitor, check_regions}'
curl -sS -H "$H" "$A/accounts/$CLOUDFLARE_ACCOUNT_ID/load_balancers/monitors" \
  | jq '.result[] | {id, description, path, interval}'
curl -sS -H "$H" "$A/zones/$CLOUDFLARE_ZONE_ID/healthchecks" | jq '.result[] | {id, name, address, interval}'
```

The drop applies only if this shows a single pool and a single monitor with `interval: 300` and `check_regions: ["NEAS"]`. Remove any extras in the dashboard. Then redeploy queue-a/b so the healthcheck handler without logging goes live: `bun run deploy:both` from `apps/reverse-proxy`.

Trade-offs:

- Detecting an unhealthy origin now takes about 5-15 minutes instead of 1-3.
- A NEAS-only probing outage could mark origins unhealthy. The impact is limited because the fallback pool is the same pool.

## 2. Browser Run in `reverse-proxy-with-playwright`

- `FETCH_PAGE_RETRY_COUNT` is now 2 attempts, down from 4, because callers already retry.
- Sessions are now reused, following the [Browser Run reuse-sessions guide](https://developers.cloudflare.com/browser-run/features/reuse-sessions/):
  - `launchBrowser` connects to an idle session, meaning one from `sessions()` that has no `connectionId`.
  - If none is free, it runs `acquire({ keep_alive: 10_000 })` and then `connect()`.
  - Because the browser always comes from `connect()`, `browser.close()` only disconnects.
  - Every request still gets its own `newContext()`. Cookies, storage and the extra `Cookie` header are scoped to the context, so nothing is shared between requests.
- Safety:
  - Retries always use a fresh session.
  - A failed attempt (Akamai block, timeout, empty page) sends CDP `Browser.close` so the session is not reused. This is best effort. If it fails, the session idles out after 10s.
  - Sign-in also reuses sessions, again with its own context.

Risks:

- Each session that ends idle is billed for an extra 10s. During sparse off-peak traffic, where requests are more than 10s apart, a request costs more than before.
- Two workers can connect to the same idle session in a race. Contexts stay isolated, but if one of them fails, the CDP kill also ends the other request. That request then retries on a fresh session.
- `sessions()` is account-scoped, so this Worker can also pick up an idle session left by another Worker on the account. Nothing in either repo sets `recording` or `guardrails`, and the new context keeps it isolated. Restrict reuse to session ids this Worker acquired if that changes.
- Idle 10s tails count against the account's concurrent-browser limit, which the JRA crons share.
- `Browser.close` over CDP and the real-world reuse rate have not been verified live. After deploying, check Browser Run usage and `history()`.

## 3. Kitesurf

No rules were added. `KITESURF_HTML_RULES` matches exact URLs only. The public callers found go through `/playwright`, for example `save-oversea-keiba-records` `history-proxy.ts`. Each of those fetches a distinct URL once and never refetches it, so an exact-URL rule would never match a second request.

The high-volume Browser Run traffic is authenticated netkeiba premium pages, which stay on Playwright (see `kitesurf-phase2.md`). Moving a public URL family such as `result.html?race_id=*` would need pattern-rule support in `kitesurf.ts`, plus content markers for each family and live parity checks.
