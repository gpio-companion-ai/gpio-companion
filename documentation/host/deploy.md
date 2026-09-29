# Deploy (host)

Deploy order: **device keys → hub Worker → dashboard (auth + KV + secret + DEVICE_HUB bind) → tell users the URLs**. Boards can boot before a user connects the GitHub App; they cannot accept signed dashboard commands until first-setup has fetched `GET /api/device-public-key` for the private key you installed on Cloudflare.

## Prerequisites

- Bun 1.2+ (1.3+ for the dashboard template)
- Cloudflare account (Pages, KV, Wrangler)
- An [openauthster](https://github.com/shpaw415) / OpenAuthster issuer the dashboard can use (`PUBLIC_AUTH_ISSUER`, `PUBLIC_AUTH_CLIENT_ID`, `AUTH_SECRET`). Enable the GitHub provider; dashboard `/login` only offers GitHub.
- OpenAuthster project roles: `user` and `admin`. New logins are `user`. Promote operators in the OpenAuthster WebUI Users page (`setUserRoleById`). Admins can open dashboard `/devices/admin` to read status and send T3/WiFi to any account’s Pi. After promoting, the user should sign in again (the first access token always carries `role: "user"` until refresh).
- This repo cloned; `bun install` at the monorepo root

```sh
bun install
bun test
bun run typecheck
```

## 1. Device Ed25519 pair

Generate once per environment (staging vs production). Private PEM must never be committed.

```sh
bun run keys:device
```

Writes:

- `.device-keys/gpio-companion-v1.private.pem` (gitignored, mode 0600)
- `.device-keys/gpio-companion-v1.public.pem`

Do **not** commit the public key. Pis register it at first-setup from `GET /api/device-public-key` (derived from this private secret).

Upload the private key as a Pages secret (from `apps/dashboard`):

```sh
bun run keys:device -- --wrangler
```

Or:

```sh
cd apps/dashboard
printf '%s' "$(cat ../../.device-keys/gpio-companion-v1.private.pem)" | wrangler pages secret put GPIO_COMPANION_DEVICE_PRIVATE_KEY --project-name gpio-companion-dashboard
```

Optional secret / var: `GPIO_COMPANION_DEVICE_KEY_ID` (default `gpio-companion-v1`).

Local dashboard: put the PEM in `apps/dashboard/.dev.vars` or `.env` as `GPIO_COMPANION_DEVICE_PRIVATE_KEY` (see `apps/dashboard/.env.exemple`).

## 2. Device hub Worker (Durable Objects)

Live GPIO, flash, T3 status, and board presence go through a per-device Durable Object WebSocket. Cloudflare Pages cannot define Durable Object classes, so this Worker must exist **before** a dashboard deploy that binds it.

App: `apps/workers/device-hub`. Wrangler name: `gpio-companion-hub` (must match the dashboard Worker). Binding: `DEVICE_HUB` / class `DeviceHub`. Same KV namespace as the dashboard (`DYNAMIC_PAGE_KV`).

### Git (Workers Builds)

Connect the existing `gpio-companion-hub` Worker to this GitHub repo (not GitHub Actions). Dashboard: **Workers & Pages** → **gpio-companion-hub** → **Settings** → **Builds** → **Connect**.

| Setting | Value |
| --- | --- |
| Git repository | `shpaw415/gpio-companion` |
| Production branch | `main` |
| Root directory | `apps/workers/device-hub` |
| Build command | `bun run ci:install` |
| Deploy command | `npx wrangler deploy` |

Workers Builds auto-runs `bun install --frozen-lockfile` with the Bun it detects **before** the build command. Default image Bun is 1.2.15, which cannot read this repo’s `bun.lock` (`lockfileVersion` 2 from Bun 1.4.0). Pin via `.bun-version` / `packageManager` `bun@1.4.0` (repo root and `apps/workers/device-hub`). Wrangler `vars.BUN_VERSION` does **not** change Workers Builds Bun (Pages uses dashboard `BUN_VERSION` + `SKIP_DEPENDENCY_INSTALL`).

The Worker name in the dashboard must stay `gpio-companion-hub` (same as `wrangler.jsonc` `name`). First-time local upload: `bun run deploy:hub`. After Git is connected, every push to `main` deploys the hub.

The dashboard `wrangler.jsonc` binds that Worker with `script_name: "gpio-companion-hub"`. Pis mint a short-lived ticket via `POST /api/hub` `{uuid,key}` then connect `wss://gpio-companion.com/api/hub`. Dashboard browsers upgrade the same path with the session cookie. Writes stay signed HTTP/BLE.

## 2b. Voice hub Worker (unused by dashboard UI)

Talk UI is removed. The dashboard does **not** bind `VOICE_HUB` / `gpio-companion-voice`. Do not deploy that Worker as a dashboard prerequisite. Source remains at `apps/workers/voice-hub` if Talk is restored later. `/api/voice/*` returns 503 while unbound.

## 3. Dashboard (Cloudflare Pages)

App: `apps/dashboard`. Wrangler project name: `gpio-companion-dashboard`. Frame Master template `cloudflare-nextjs`.

### KV

Create a KV namespace and replace `<kv-binding-id>` in `apps/dashboard/wrangler.jsonc` (`DYNAMIC_PAGE_KV`). JLCPCB order drafts are not in KV. They live in D1 binding `DASHBOARD_DB` (`gpio-companion-dashboard`). Generate schema changes with `bun run db:generate` in `apps/dashboard`, then apply with `bun run db:apply:remote`. Do not hand-write `drizzle/*.sql`. Pairing records are stored as `device:<userId>` (array) and `pair:<uuid>`. GitHub App installs are `github-app:<userId>`. Legacy PATs may still exist as `github:<userId>`. AI credits are `credits:<userId>` as `{v:2,micros}` (USD microdollars; legacy integer credits migrate at $0.01 each). PayPal pack orders are `paypal-order:<orderId>` so capture is granted once. OpenCode on the Pi talks to loopback `/v1/ai`; the companion mints a ~1h device token via `POST /api/ai/credentials` (pairing uuid+key). AI routes bill the live owner of `pair:<uuid>`. Legacy hashed keys `ai:<sha256>` still work until boards update. Enable the `AI` Workers AI binding in wrangler. Set `GPIO_AI_MARKUP` (default `1.25`). GLM-5.3 (`@cf/zai-org/glm-5.3`) requires Workers Paid or AI Gateway prepaid credits.

### GitHub App (required)

Users do **not** paste a PAT. Each signed-in user installs **your** GitHub App from dashboard `/devices/keys`. The Pi never stores a long-lived token: `git push` calls `gpio-companion git-credential`, which hits loopback `GET /v1/github-token`, which `POST`s pairing uuid+key to `https://gpio-companion.com/api/github-credentials`. The dashboard mints a 1-hour installation token (`ghs_…`) and git uses username `x-access-token`.

If a board is offline for more than an hour, the user does nothing except push again once it has internet.

#### Create the App (once per environment)

1. GitHub (org or user that owns gpio-companion) → **Settings → Developer settings → GitHub Apps → New GitHub App**.
2. Fill:

   | Field | Value |
   | --- | --- |
   | GitHub App name | `gpio-companion` (or `gpio-companion-staging`). This becomes the **slug** in `https://github.com/apps/<slug>`. |
   | Homepage URL | `https://gpio-companion.com` |
    | Callback URL | `https://gpio-companion.com/profile/github` (OAuth user-token exchange). Also keep `https://gpio-companion.com/devices/keys`. |
   | Expire user authorization tokens | leave default |
    | Request user authorization (OAuth) during installation | **checked** (needed to create user repos; installation tokens cannot `POST /user/repos`) |
   | Setup URL (Post installation) | `https://gpio-companion.com/devices/keys` |
   | Redirect on update | **checked** so GitHub returns `?installation_id=&setup_action=&state=` |
   | Webhook | **unchecked** (inactive). This App does not consume webhooks. |
   | Where can this GitHub App be installed? | **Any account** |

3. Repository permissions (only these):

   | Permission | Access | Why |
   | --- | --- | --- |
   | **Contents** | Read and write | clone / commit / `git push` |
   | **Metadata** | Read-only | mandatory with Contents |
    | **Administration** | Read and write | dashboard **creates** repos under the installer account (org REST or user GraphQL; installation tokens cannot `POST /user/repos`) |

   Leave all other repository, organization, and account permissions **No access**.

4. Create the App. On the app page copy:

   - **App ID** — integer, e.g. `123456` → `GITHUB_APP_ID`
    - **Public link** `/apps/<slug>` → `GITHUB_APP_SLUG` (the path segment only, e.g. `gpio-companion`)
    - **Client ID** — `Iv1…` / `Iv23…` → `GITHUB_APP_CLIENT_ID`
5. **Generate a private key**. GitHub downloads `*.pem` (`-----BEGIN RSA PRIVATE KEY-----` or `BEGIN PRIVATE KEY`). Store it outside git (mode 0600). This is `GITHUB_APP_PRIVATE_KEY`. You cannot re-download it; generate a new key if lost.
6. **Generate a client secret** (Client secrets → Generate). This is `GITHUB_APP_CLIENT_SECRET`. You cannot re-download it. Optional: set the app logo. Leave “Expire user authorization tokens” on; the dashboard stores the refresh token and mints a user access token (`ghu_`) to **create** repos. Boards still mint **installation** tokens (`ghs_`) for `git push`.

Staging: repeat as a second App (`gpio-companion-staging`) with Setup URL `http://localhost:3010/devices/keys` (or your tunnel). Do not reuse production keys.

#### Put credentials on Cloudflare Pages

From `apps/dashboard` (`--project-name gpio-companion-dashboard`):

```sh
# public identifiers — vars are fine
npx wrangler pages secret put GITHUB_APP_ID
# paste the numeric App ID

npx wrangler pages secret put GITHUB_APP_SLUG
# paste the slug only, e.g. gpio-companion

# Client secret — never commit, never PUBLIC_
printf '%s' "$GITHUB_APP_CLIENT_SECRET" | npx wrangler pages secret put GITHUB_APP_CLIENT_SECRET

# private PEM — never commit, never PUBLIC_
printf '%s' "$(cat /path/to/gpio-companion.private-key.pem)" | npx wrangler pages secret put GITHUB_APP_PRIVATE_KEY
```

Local (`apps/dashboard/.dev.vars` or `.env`, see `.env.exemple`):

```
GITHUB_APP_ID=123456
GITHUB_APP_SLUG=gpio-companion
GITHUB_APP_CLIENT_ID=Iv23…
GITHUB_APP_CLIENT_SECRET=
GITHUB_APP_PRIVATE_KEY="-----BEGIN RSA PRIVATE KEY-----\n...\n-----END RSA PRIVATE KEY-----"
```

Newlines in `.dev.vars` can be literal; Wrangler accepts a PEM block. Never prefix these with `PUBLIC_`.

#### Runtime map

| Piece | Location |
| --- | --- |
| App install record | KV `github-app:<userId>` = `{ installationId, login }` |
| Install CSRF | KV `github-app-state:<uuid>` (TTL 15 min) |
| Dashboard mint | `GET`/`POST` `/api/github-app` (signed-in user) |
| Pi mint | `POST /api/github-credentials` body `{ uuid, key }` (pairing secret, TLS) |
| Git on the Pi | `/etc/gitconfig` helper `!/usr/local/bin/gpio-companion git-credential` |
| Agent API token | `gpio-companion github-token` (same mint path) |

`/projects` lists **installation** repos (`GET /installation/repositories`), not `/user/repos`. Creating a project uses a GitHub App **user** access token (`POST /user/repos`, UAT-only) after Profile → GitHub OAuth; organization installs can still `POST /orgs/{org}/repos` with an installation token. Installation tokens (`ghs_`) cannot create user repos (`403 Resource not accessible by integration`). Legacy KV `github:<userId>` PATs still work if present; Keys no longer collects them.

#### Confirm

1. Dashboard `/devices/keys` while signed in shows **Connect GitHub** (not a PAT form). If you see `github app is not configured`, the three secrets are missing on that Wrangler environment.
2. Install the App on a test GitHub account (all repos or selected).
3. Redirect lands on `/devices/keys` with `installation_id` + `state`; page shows **Connected as @login**.
4. On a paired Pi: `curl -sS http://127.0.0.1:4150/v1/github-token` (loopback only) returns `token` starting `ghs_`. `git push` to a repo the App can access succeeds without a PAT.

### Vars (wrangler.jsonc and/or Pages)

Committed `vars` override dashboard-only values if they are empty strings. Set real origins in wrangler (or stop shipping empty baked vars).

| Name | Role |
| --- | --- |
| `PUBLIC_AUTH_CLIENT_ID` | OpenAuthster client (default `__gpio_companion__`) |
| `PUBLIC_AUTH_ISSUER` | Auth issuer URL |
| `PUBLIC_AUTH_REDIRECT_URI` | Must match the deployed origin + `/callback` |
| `AUTH_SECRET` | OpenAuthster client secret (secret, not a public var) |
| `GPIO_COMPANION_DEVICE_PRIVATE_KEY` | Ed25519 PKCS8 PEM (secret) |
| `GPIO_COMPANION_DEVICE_KEY_ID` | `gpio-companion-v1` |
| `GITHUB_APP_ID` | GitHub App id (secret/var) |
| `GITHUB_APP_PRIVATE_KEY` | GitHub App private PEM (secret) |
| `GITHUB_APP_SLUG` | GitHub App slug for `/apps/{slug}/installations/new` |
| `PUBLIC_PAYPAL_CLIENT_ID` | PayPal REST app client id (wrangler var; do not bake empty) |
| `PAYPAL_CLIENT_SECRET` | PayPal REST app secret (Pages secret) |
| `PAYPAL_ENV` | `sandbox` or `live` (wrangler var; start sandbox) |
| `CLOUDFLARE_EMAIL_API_TOKEN` | Email Sending REST token, permission Email Sending: Edit (Pages secret). Not the Pi tunnel token. |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account id for Email Sending (wrangler var). Do not bake empty. |

`PUBLIC_*` is injected into the browser. Never put `GPIO_COMPANION_DEVICE_PRIVATE_KEY`, `AUTH_SECRET`, `GITHUB_APP_PRIVATE_KEY`, `PAYPAL_CLIENT_SECRET`, or `CLOUDFLARE_EMAIL_API_TOKEN` under a `PUBLIC_` name. Bug reports use Email Sending REST (`POST /accounts/{account_id}/email/sending/send`). Pages rejects `send_email`.

### Local

```sh
cp apps/dashboard/.env.exemple apps/dashboard/.env
# set WRANGLER_PORT, AUTH_*, GPIO_COMPANION_DEVICE_PRIVATE_KEY
bun run dev:dashboard
```

Dev server: http://localhost:3000 (proxies Wrangler). New page files need a restart.

### Production

```sh
bun run build:dashboard
bun run deploy:dashboard
```

`deploy` runs `bun run build` then `wrangler pages deploy .frame-master/build --project-name gpio-companion-dashboard`.

Confirm:

- Sign-in at `/login` → `/callback`
- `/pair`, `/wifi`, `/keys`, `/projects` load while authenticated
- A signed `PUT /v1/config/wifi` or pairing claim against a lab Pi succeeds (401/403 from the Pi means key mismatch or unsigned call)

## 4. GitHub (user accounts)

The host does **not** run Gitea. Each dashboard user uses **their GitHub account** by installing **your** GitHub App (section 2). You do not collect PATs.

If an old `gitea-container` Worker is still deployed, delete it (`wrangler delete gitea-container`).

## 5. Cloudflare tunnel (device API)

Each board gets its **own remotely-managed Cloudflare Tunnel** at first-setup (not a shared replica). Zone: `gpio-companion.com`.

First-setup prompts for:

- Cloudflare API token (Account Cloudflare Tunnel Edit + Zone DNS Edit) — **not stored on the Pi**
- Account ID
- Zone ID

It creates `gpio-<pairing-uuid>`, publishes:

- `api-<uuid>.gpio-companion.com` → `http://127.0.0.1:4150`

`<uuid>` is the pairing UUID with dashes stripped. There is no `t3-<uuid>` hostname and no public code hostname. OpenCode stays on `127.0.0.1:4096` and is reached through the signed device API proxy. Replica token lives in `/etc/gpio-companion/cloudflared.env`. Signed `PUT /v1/config/tunnel` can still rewrite it.

first-setup writes the OpenCode provider to `http://127.0.0.1:4150/v1/ai` (dummy `apiKey: local`). gpio-companion serve proxies that loopback path to `/api/ai/v1` with a short-lived device token minted from pairing uuid+key. Default model `@cf/zai-org/glm-5.3`. Open Code in the dashboard lists priced Workers AI text-generation models; reasoning models expose thinking-effort variants (`low` / `medium` / `high`). `GET /api/ai/v1/models` returns that same chat catalog. `POST /api/ai/v1/chat/completions` forwards OpenAI `tools`/`tool_calls` and `reasoning_effort`, and bills Cloudflare list in/out (cached-in when present) × `GPIO_AI_MARKUP`. Unpair deletes `pair:<uuid>` so the token stops working. Do not paste OpenCode or Cloudflare tokens on Keys. GitHub access is the App install on Keys, not a PAT.

## 6. What users need from you

Give every desk user:

1. Dashboard origin (and that they must use Chrome/Edge for in-browser Bluetooth)
2. That projects live on **their GitHub**; after pair they **Connect GitHub** on `/devices/keys` (install your App — no PAT)
3. Cloudflare API token / account ID / zone ID for first-setup (Tunnel Edit + DNS Edit on `gpio-companion.com`)
4. That pairing UUID + key and the `api-` URL are printed **on the Pi console** at first-setup — you do not email those
