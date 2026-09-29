# Host workflows

## Ship a desktop companion release

1. Set the same version (not `0.0.0`) in `apps/desktop/package.json` and `apps/desktop/src-tauri/tauri.conf.json`
2. Merge to `main` (or run **Release desktop** via `workflow_dispatch`)
3. GitHub Actions builds Windows / Linux / macOS and publishes `desktop-v<version>` on the repo Releases page
4. If that tag already exists, the workflow skips (safe rerun)

Unsigned macOS artifacts may need a right-click Open until Apple signing is configured. A non-empty `apps/desktop/release-notes/v<version>.md` becomes the release notes; a hyphen in the version marks the release as a prerelease.

## Ship a mobile companion release

1. Set the same version (not `0.0.0`) in `apps/mobile/package.json` and `apps/mobile/app.json` `expo.version`
2. Optional notes: `apps/mobile/release-notes/v<version>.md` (non-empty). A hyphen in the version marks a prerelease
3. Merge to `main` (or run **Release mobile and dashboard** via `workflow_dispatch`)
4. GitHub Actions builds an Android arm64 APK and publishes `mobile-v<version>` on the repo Releases page
5. If that tag already exists, the workflow skips (safe rerun)

The APK is debug-signed for sideload. iOS is not published until Apple signing is configured. `android/` and `ios/` stay gitignored; CI runs `expo prebuild`.

## Ship a dashboard release

1. Set `apps/dashboard/package.json` `version` (not `0.0.0`)
2. Optional notes: `apps/dashboard/release-notes/v<version>.md`
3. Merge to `main` (or `workflow_dispatch`)
4. GitHub Actions builds the production site and publishes `dashboard-v<version>` with a zip of `.frame-master/build`
5. If that tag already exists, the workflow skips

The live site still deploys from the push to `main` through Cloudflare. The release workflow does not run `wrangler`.

## Ship a dashboard change

1. Implement in `apps/dashboard` (and `packages/core` if signing/BLE envelope changed)
2. `bun test` and `bun run typecheck`
3. Push to `main`. Cloudflare deploys from that push. Do not run `wrangler deploy` or `bun run deploy:dashboard`
4. Public-key rotation does **not** need a git commit; boards fetch `GET /api/device-public-key` on the next updater run (or `sudo gpio-companion-update`)

## Rotate device signing keys

1. `bun run keys:device`
2. `wrangler pages secret put GPIO_COMPANION_DEVICE_PRIVATE_KEY` with the new PEM (never commit `.device-keys/`)
3. Deploy dashboard if you also changed signing code; the public-key endpoint derives from the new secret immediately
4. Wait until Pis run the updater (boot / 24h) or SSH `sudo gpio-companion-update`, or they will 403 all signed calls

There is no multi-key ring yet — rotation is cutover.

## Help a user pair

You cannot pair for them without their dashboard login. They need:

- Device URL (`https://api-<uuid>.gpio-companion.com` from first-setup)
- Pairing UUID + key from the Pi’s first-setup console / `pairing.env`

Host debug on the board (SSH/serial):

```sh
curl -sS http://127.0.0.1:4150/health
sudo systemctl status gpio-companion
sudo journalctl -u gpio-companion -n 80 --no-pager
sudo systemctl status gpio-companion-cleanup.timer
sudo gpio-companion-cleanup
# pairing UUID only (not the key) if they lost the printout — the key is in pairing.env mode 600
sudo grep GPIO_COMPANION_PAIRING_UUID /etc/gpio-companion/pairing.env
```

Do not paste pairing keys into tickets. If the key is lost, regenerate `pairing.env` and they re-claim (existing claim is bound to `userId`).

## WiFi / BLE support

- Chrome/Edge: dashboard `/wifi` uses Web Bluetooth
- Native companion: `apps/mobile` (iOS/Android) and `apps/desktop` (Windows/Linux/macOS) use native GATT and `/api/mobile/*`
- iOS Safari: sign-and-copy → LightBlue or nRF Connect, UTF-8 JSON to command characteristic
- Signed body UUID must match the Pi
- `GPIO_COMPANION_BLE=0` disables advertising
- `python3-dbus` / `python3-gi` / `bluez` missing → BLE skipped; Ethernet/TTY still valid
- GATT helper missing (`gpio-companion ble: script not found, skipping`) → install copies it to `/usr/local/lib/gpio-companion/ble-gatt-server.py`; unit sets `GPIO_COMPANION_BLE_SCRIPT`
- `advertise failed: …` includes the BlueZ D-Bus error; leftover ads are unregistered and retried; name-only advert (Web Bluetooth filters `namePrefix`)

## Secrets ownership

| Secret | Where it lives | Who sets it |
| --- | --- | --- |
| Device Ed25519 private | Cloudflare Pages secret | Host |
| Device Ed25519 public | `/etc/gpio-companion/device-auth.json` | Pi fetches `GET /api/device-public-key` |
| OpenAuthster `AUTH_SECRET` | Pages secret | Host |
| Pairing UUID/key | `/etc/gpio-companion/pairing.env` | First-setup on the Pi |
| GPIO AI access | loopback `GET/POST /v1/ai/*` → `POST /api/ai/credentials` | Pairing uuid+key; ~1h device token; unpair revokes |
| JLCPCB API keys | Pages secrets `JLCPCB_APP_ID`, `JLCPCB_ACCESS_KEY`, `JLCPCB_SECRET_KEY` | Host. One application for the dashboard. Pi loopback `GET`/`POST /v1/jlcpcb` uses the device token. Never on the Pi or in Profile. |
| GitHub App private key | Cloudflare Pages secret `GITHUB_APP_PRIVATE_KEY` | Host (generate on the App settings page) |
| GitHub App ID / slug | Pages secret/var `GITHUB_APP_ID`, `GITHUB_APP_SLUG` | Host |
| GitHub installation | KV `github-app:<userId>` | User via Keys **Connect GitHub** |
| GitHub installation token (`ghs_`) | minted on demand, ~1h | Pi `git-credential` / `GET /v1/github-token` → `POST /api/github-credentials` |
| PayPal REST secret | Pages secret `PAYPAL_CLIENT_SECRET` | Host |
| PayPal client id / env | wrangler vars `PUBLIC_PAYPAL_CLIENT_ID`, `PAYPAL_ENV` | Host |
| Tunnel replica token | `cloudflared.env` | First-setup Cloudflare API (token itself is not stored) |
| Cloudflare API token | console only | First-setup; never written to disk |

Never put Cloudflare or GitHub user tokens in the image. AI credits live in dashboard KV (`credits:<userId>` as USD microdollars, billed at Workers AI list in/out × `GPIO_AI_MARKUP`). Users buy $5 / $10 / $25 / $50 USD packs with PayPal on `/profile/credits`; grants are face value. `$1` stub is admin-only.

## Break-glass on a bricked network

Physical console (HDMI/serial): first-setup TTY, Ethernet, or `nmcli` as root. BLE is only for users who can reach the **dashboard** (their phone/laptop has internet) while the Pi does not.

## What not to invent

gpio-companion.com subscription SKUs beyond PayPal credit packs, and Orange Pi SKU matrix, are not locked. Host docs stop at the services and image paths above.
