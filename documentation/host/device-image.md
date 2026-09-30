# Device image and on-metal install (host)

The board is Armbian with OpenCode. Exact image SKUs are **not locked**. What is locked: per-hardware install scripts and the snapshot first-boot path.

## Snapshot first boot

`scripts/snapshot/gpio-companion-first-boot.sh` is copied onto the image as `/usr/local/sbin/gpio-companion-first-boot`.

On first boot (no `/etc/gpio-companion/first-setup-complete`):

1. Installs `git` + `ca-certificates`
2. Clones `GPIO_COMPANION_REPO_URL` (default this GitHub repo) to `GPIO_COMPANION_REPO` (default `/opt/gpio-companion`), branch `GPIO_COMPANION_BRANCH` (default `main`)
3. `exec`s interactive `scripts/first-setup.sh`

Optional unit: `scripts/snapshot/gpio-companion-first-boot.service` on tty1 until the marker exists.

The clone does **not** bake a production public key. First-setup fetches it from `GET ${GPIO_COMPANION_DASHBOARD_URL:-https://gpio-companion.com}/api/device-public-key` and writes `/etc/gpio-companion/device-auth.json`. The dashboard must already have `GPIO_COMPANION_DEVICE_PRIVATE_KEY` set.

## First-setup (what the script does)

`scripts/first-setup.sh` (root, TTY unless env is fully set):

1. Grants the GPIO user passwordless sudo (`/etc/sudoers.d/gpio-companion`, `NOPASSWD: ALL`, `!requiretty`) so the on-device agent can `sudo` without a TTY or password
2. Hardware: `raspberrypi` or `orangepi` (guessed from `/proc/device-tree/model`)
3. Cloudflare API token, account ID, and zone ID (creates a per-Pi tunnel; token is not written to disk)
4. Runs `scripts/install-raspberrypi.sh` or `scripts/install-orangepi.sh`
5. Generates pairing UUID + key into `/etc/gpio-companion/pairing.env` (mode 600) if unset
6. Creates `gpio-<uuid>` on Cloudflare with `api-<slug>` → :4150. No public code hostname.
7. Writes `/etc/gpio-companion/config.json` and `cloudflared.env`, enables the replica
8. Fetches the dashboard Ed25519 public key into `/etc/gpio-companion/device-auth.json` (fails closed if the dashboard is unreachable)
9. Writes `/etc/gpio-companion/first-setup-complete`

It does **not** collect OpenCode or GitHub secrets. It installs the GPIO-user OpenCode server on `127.0.0.1:4096` and does not install T3 Code.

Prints pairing UUID/key plus `https://api-…`. Treat that console output as a physical possession secret.

Non-interactive: `GPIO_COMPANION_HARDWARE`, `GPIO_COMPANION_CF_API_TOKEN`, `GPIO_COMPANION_CF_ACCOUNT_ID`, `GPIO_COMPANION_CF_ZONE_ID`, optional `GPIO_COMPANION_DASHBOARD_URL` (default `https://gpio-companion.com`).

Force re-run: `GPIO_COMPANION_FORCE_SETUP=1`.

## Install scripts

Shared work: `scripts/lib.sh` → `install_common`.

Packages include: git, zip/unzip, bun, build-essential, node-gyp toolchain, libgpiod, Arduino USB (`avrdude`, `picocom`, …), cloudflared, OpenCode, **bluez**, **python3-dbus**, **python3-gi** (BLE GATT), **network-manager** (`nmcli` for `PUT /v1/config/wifi`), **dosfstools** (removable SD/USB → `~/storage/<label>`).

- Raspberry Pi extras: optional `pigpio` / `raspi-gpio`
- Orange Pi extras: optional WiringOP — SoC lines are **not** BCM; agents must use `gpioinfo`

Device binary: compiled `gpio-companion` on PATH (`/usr/local/bin/gpio-companion`).

Printable parts: `/usr/local/bin/gpio-3d` runs a venv at `/usr/local/lib/gpio-companion/gpio-3d` (`trimesh`, `numpy`, `manifold3d`, wheels only). Code is `native/gpio-3d` on `PYTHONPATH`, so an Update companion picks up helper changes without reinstalling wheels. armhf is skipped (no wheel, no compile). Install is refused under 200MB free on `/`.

Systemd:

- `gpio-companion.service` — `gpio-companion serve` on port **4150**, after network + bluetooth, as the GPIO user (`User=` / `GPIO_USER` / `SupplementaryGroups=gpio`, typically `companion` when first-setup is run with sudo). OpenCode is that same user’s systemd user unit (`gpio-opencode.service` on `127.0.0.1:4096`). Updater/cleanup/cloudflared stay root.
- `gpio-companion-update.timer` — updater OnBootSec=2min and every 24h (`Persistent=true`). Unit runs `/usr/local/sbin/gpio-companion-update` as root. The same wrapper is on PATH at `/usr/local/bin/gpio-companion-update`; if the GPIO user runs it, it re-execs with `sudo -n` (NOPASSWD, no TTY) then `scripts/update-script.sh`. `gpio-companion-force-update` is the `--force` variant.
- `gpio-companion-cleanup.timer` — disk/log cleanup OnBootSec=1min and every hour (`Persistent=true`); journals `MaxRetentionSec=1day`, `SystemMaxUse=64M`, `ForwardToSyslog=no` (drop-in `/etc/systemd/journald.conf.d/zz-gpio-companion.conf` so it sorts after Debian `syslog.conf`)
- `gpio` group + udev `99-gpio-companion-gpiochip.rules` — `/dev/gpiochip*` is `0660` `gpio`; `gpio-companion.service` has `SupplementaryGroups=gpio` so Live GPIO does not `sudo` `gpioget`/`gpioinfo` (sudo remains fallback on EACCES)

Env the unit loads:

- `GPIO_COMPANION_CONFIG=/etc/gpio-companion/config.json`
- `GPIO_COMPANION_SECRETS=/etc/gpio-companion/secrets.env`
- `GPIO_COMPANION_PAIRING=/etc/gpio-companion/pairing.json`
- `EnvironmentFile=-/etc/gpio-companion/pairing.env` (`GPIO_COMPANION_PAIRING_UUID`, `GPIO_COMPANION_PAIRING_KEY`)
- `GPIO_COMPANION_HARDWARE=raspberrypi|orangepi`

The binary also reads `/etc/gpio-companion/device-auth.json` (`keyId`, `publicKeyPem`) written by first-setup / the updater.

## Device API (what you are exposing)

`gpio-companion serve` binds `0.0.0.0:4150` (override `GPIO_COMPANION_PORT`).

| Route | Auth |
| --- | --- |
| `GET /health` | none |
| `GET /v1/status`, `GET /v1/logs`, pairing, config, secrets, github, **wifi**, **opencode** | Ed25519 dashboard signature (60s skew once NTP/clock is trusted; nonce replay list while offline) |
| `POST /v1/pairing/claim` | signature **and** pairing UUID + key |
| `GET /v1/opencode/global/health` | signature |
| `GET /v1/opencode/event/<repo>` websocket | signature query, Origin allowlist; bridges loopback SSE |

Signature headers: `X-Gpio-Key-Id`, `X-Gpio-Timestamp`, `X-Gpio-Nonce`, `X-Gpio-Signature`. 60s skew. Canonical version `gpio-companion-device-v1`.

If the board is on a tunnel URL, that origin must only be reachable as you intend (Cloudflare Access is an open host choice — not locked).

## Bluetooth WiFi (on-device)

`gpio-companion serve` starts `scripts/ble-gatt-server.py` unless `GPIO_COMPANION_BLE=0`. No adapter → skip. Advertisement prefers the 128-bit service UUID plus local name `gpio-companion` (Web Bluetooth Chrome filters on the UUID; nRF Connect can use the name). If BlueZ rejects the PDU size, it retries UUID+`gpio`, UUID-only, then name-only. The BlueZ adapter **Alias** is `gpio-companion` so scanners do not show the hostname (`orangepi3-lts`).

| Item | Value |
| --- | --- |
| Advertised name | `gpio-companion` |
| Service | `a1c15e00-6f10-4c9a-9c31-47b0c15e0001` |
| Info (read) | pairing UUID, hardware |
| Command (write) | length-prefixed frames **or** UTF-8 JSON starting with `{` |
| Status (notify) | device API JSON |

Python forwards the signed envelope to `http://127.0.0.1:4150` (still verified). `PUT /v1/config/wifi` requires body UUID = local pairing UUID, then `nmcli device wifi connect`.

Script path, first existing file: env `GPIO_COMPANION_BLE_SCRIPT` (unit default `/usr/local/lib/gpio-companion/ble-gatt-server.py`), then that installed copy, then `$repo/scripts/ble-gatt-server.py` from `/etc/gpio-companion/repo.path`, then `/opt/gpio-companion/scripts/ble-gatt-server.py`, then a source-tree relative path (dev). Install copies `scripts/ble-gatt-server.py` next to the binary helper dir. Missing script → skip (`gpio-companion ble: script not found, skipping`).

## Updater

`scripts/update-script.sh` (timer):

- Corruption guard then `git fetch --depth 1` + `reset --hard origin/<branch>` (`/etc/gpio-companion/branch` or `main`): prune empty git objects, retry, reclone `.git` if still corrupt. Root updater uses `git -c safe.directory=<checkout>` so a companion-owned tree is not treated as corrupt (`dubious ownership`); after fetch/reset/reclone the checkout is chowned to `GPIO_USER` so `.git` does not stay root-owned under `/home/<user>`
- Reinstalls the SD/USB home-link helper (`scripts/storage-link.sh`, udev + systemd) so extra media appears at `~/storage/<label>`
- Copies `opencode/skills` and `opencode/preferences` into the device OpenCode config
- Fetches `GET /api/device-public-key` and writes `/etc/gpio-companion/device-auth.json` if it changed
- Rebuilds/restarts `gpio-companion` if `binary/`, `packages/core/`, the unit file, or lockfile changed, or if the registered public key changed
- Installs or restarts the GPIO-user OpenCode unit and runs `opencode upgrade`. It does not install or start T3 Code.
- Force rebuild even when HEAD did not move: `sudo ./scripts/force-update.sh` or `sudo gpio-companion-force-update` (`--force` / `GPIO_COMPANION_UPDATE_FORCE=1`)
- Dashboard owner or admin can start the same timer job remotely: signed `POST /v1/update` → `systemctl start --no-block gpio-companion-update.service` (HTTP returns immediately; the board may restart)
- Dashboard project create signs `POST /v1/projects/sync` `{ owner, name }` to each hub-live paired board (clone `~/projects/<name>`). Offline boards are skipped. Serve also lists watermarked installation repos at start and every 15 min.
- Dashboard project delete signs `POST /v1/projects/remove` `{ owner, name }` to each hub-live paired board (delete `~/projects/<name>` when origin matches). Offline boards are skipped. GitHub delete still works without a live board.

Public-key rotations are **dashboard-only** (new Pages secret); Pis pick them up on the next updater run without a git commit. Fetch failure keeps the current file.
