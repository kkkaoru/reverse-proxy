# reverse-proxy

## Workspace Layout

- `apps/reverse-proxy/src` – Cloudflare Worker implementation powered by Hono.
- `apps/reverse-proxy/tests` – Vitest suite targeting the Worker.
- `apps/reverse-proxy/wrangler.toml` – Worker deployment settings.
- `apps/reverse-proxy/.dev.vars` – Local-only variables (ignored by git); copy from `.dev.vars.example`.

Root `package.json` manages the Bun workspace (`"workspaces": ["apps/*"]`) and centralizes dependencies. See the Bun workspaces guide for more details on the layout.citeturn0search1

## Configuration

- Copy `apps/reverse-proxy/.dev.vars.example` to `apps/reverse-proxy/.dev.vars`, add required bindings (for example `CLOUDFLARE_ACCOUNT_ID`), and keep `.dev.vars` untracked.
- `API_DOMAIN` in the vars file determines the custom subdomain (under `kkk4oru.com`) where the API is served.
- Set `LOG_REQUESTS` to `1` (or `true`) in the vars file when you want console logging from the proxy middleware.
- For production, define plaintext vars under `[vars]` in `apps/reverse-proxy/wrangler.toml` or set them via `wrangler variables put` / the Cloudflare dashboard, and store sensitive values with `wrangler secret put`.
- `account_id` is supplied through environment variables (for example `CLOUDFLARE_ACCOUNT_ID`) or `wrangler login`, so it remains out of `wrangler.toml`.
