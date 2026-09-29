# gpio-companion

On-device AI coworker for GPIO boards (Orange Pi / Raspberry Pi): Armbian + OpenCode/T3Code, tscircuit breadboard/PCB, GitHub projects, Bun web, Arduino C over USB. Future dashboard: gpio-companion.com.

Vision: `PRODUCT.md` (raw). Agent rules: `opencode/preferences`, `opencode/skills`.

Operator deploy and image docs: `documentation/host/`. Desk user setup and daily workflows: `documentation/user/`.

```txt
.
├── apps/                 # dashboard, mobile, desktop
├── packages/             # shared libraries
├── binary/               # on-device binary + config API
├── scripts/              # per-hardware Armbian install
└── opencode/             # on-device agent skills and preferences
```

## Workspaces

| Path | Package | Role |
| --- | --- | --- |
| `packages/core` | `gpio-companion` | shared library |
| `apps/web` | `gpio-companion-web` | web companion |
| `apps/dashboard` | `gpio-companion-dashboard` | Cloudflare Pages dashboard |
| `apps/mobile` | `gpio-companion-mobile` | Expo BLE companion (iOS/Android; not a Bun workspace) |
| `apps/desktop` | `gpio-companion-desktop` | Tauri BLE companion (Windows/Linux/macOS; not a Bun workspace) |
| `binary/gpio-companion` | `gpio-companion-bin` | standalone binary |

## Scripts

```sh
bun install
bun test
bun run typecheck
bun run dev
bun run dev:dashboard
bun run deploy:dashboard
bun run compile
sudo ./scripts/install-raspberrypi.sh
sudo ./scripts/install-orangepi.sh
sudo ./scripts/update-script.sh
sudo ./scripts/force-update.sh
sudo ./scripts/snapshot/gpio-companion-first-boot.sh
sudo ./scripts/first-setup.sh
```

First-setup creates a per-Pi Cloudflare tunnel. The on-device API (port 4150) is published as an `api-` hostname. OpenCode stays on loopback and is opened from the dashboard Open Code page. Dashboard `/pair` claims the board.
