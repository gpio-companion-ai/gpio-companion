# newUI route map — B6 mock → real code

## Work (rail 📁 → `/project`)

| Mock | Real |
|---|---|
| Repo list + branch chips | `ProjectBrowser` + GitHub branch API (reload on focus; newest-commit default) |
| `host/*.c` viewer | File viewer (new, read-only + copy); run config from `RunPanel` |
| `diagram.json` viewer | `BreadboardViewer` (+ Wokwi overlay; mobile `/embed/breadboard` stays) |
| `circuit.json` / `preview.svg` | `PcbViewer` |
| Run / Stop | `RunPanel` → `POST /v1/run`, `/v1/run/stop`; console → `LiveConsole` (`wss://…/v1/console`) |
| Flash Arduino | `FlashPanel` → `POST /v1/flash` (+ sketches/ports GETs) |
| Verify circuit | `VerifyPanel` → `POST /v1/verify` + net overlay |
| Save to GitHub | existing save flow (`POST /v1/projects/push` signed) |
| New project | existing create flow (`POST /v1/projects/sync` to hub-live boards) |

## Fleet (rail 🧠 → `/devices/*`)

| Mock | Real |
|---|---|
| Board list + selection | `DeviceBoardCard` list; selection key `gpio-companion-selected-board` (+ legacy T3 key) |
| Overview actions | Open Code (`/devices/code`), `FlashProxyButton` (`POST /v1/flash/proxy`), `GpioPanel`, unpair (`DELETE` pair API) |
| Proxy state | `GET /v1/arduino-proxy`; `ArduinoProxyPins` for the Companion/Arduino switcher |
| Pair page | `PairForm` (centered empty-state + dialog variant both stay) |
| WiFi page | `WifiBleForm` (GATT + sign-and-copy) |
| Docs page | `DocsMarkdown` over `documentation/user/*` + pinout skills; `/devices/docs?id=` readers |
| Debug page | `DeviceDebugPanel` / `DebugLog` (redacted 24h, disk snapshot, update trigger) |
| Requests page | `NotificationCenter` (accept/reject transfer) |
| Label edit | `DeviceLabelField`; companion facts `DeviceCompanionInfo` |

## Code (rail 💻 → `/devices/code`)

| Mock | Real |
|---|---|
| Session list + prompt | In-app Open Code session (`OpenCodeSession`) on web, desktop, and mobile. No T3 iframe. |

## You (rail 👤 → `/profile/*`)

| Mock | Real |
|---|---|
| Account | `LanguageCard`, auth session (`useAuth`), sign out |
| Credits | `/profile/credits` (balance, PayPal packs, usage; `$1` stub admin-only) |
| Keys & tunnels | `KeysForm` (GitHub push `PUT /v1/config/github`, secrets `PUT /v1/config/secrets`) |

## Shell pieces (new, per app — do not share files)

| Mock | Build |
|---|---|
| Rail + sidebar + split + inspector + statusbar | New layout components in each app (`apps/dashboard/src/components/deck/*`, desktop `src/components/deck/*`, mobile screens) |
| ⌘K palette | New component per app (web/desktop: overlay; mobile: full-screen sheet) |
| Sdock (tabs+grip+persist) | New component; tabs reuse `LiveConsole`, `GpioPanel`, `FlashPanel` |
| Mobile drawer | CSS once per app (web/desktop) + navigator drawer (mobile) |
| Strings | `packages/core/src/i18n/en.ts` + `fr.ts` (+ `LOCALES` entry if adding a language — not needed here) |
| Loading/empty states | Existing `skeletons.tsx` + `loading.tsx` patterns |

## APIs reused (no backend changes)

`GET /v1/arduino-proxy` → proxy-first check · `/v1/run` · `/v1/flash` (+`/proxy`)
· `/v1/verify` · `/v1/gpio` (GET snapshots; PUT testing-only) · `/v1/console`
(WS) · pairing/claim · `/v1/config/wifi|github|secrets|tunnel` · `/v1/projects/*`
· `/api/device-public-key` · `/api/ai/*` (unchanged) · `/api/voice/*` (stays 503)
