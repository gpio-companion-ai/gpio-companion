# gpio-companion TODO

One agent session = one task. Copy only that task's prompt. Do not start the next task in the same session.

If a dependency is not already in the tree, stop and report it. Do not build the dependency in this session.

## Session rules

- Read `PRODUCT.md`, `AGENTS.md`, and `opencode/preferences/` first.
- Mirror UX on `apps/dashboard`, `apps/desktop`, and `apps/mobile`. Do not share React files.
- English and French only, typed catalogs in `packages/core/src/i18n` (`en.ts`, `fr.ts`). Marketplace copy lives in `apps/marketplace/src/i18n`.
- Bun for web and scripts. Browser never calls the Pi.
- Do not commit unless the user asked in this session.
- Do not invent prices, fees, or locked product claims.
- Update `PRODUCT.md` only for behavior this session actually ships.
- When Done when passes, set this task's status to `done` in this file. Do not mark other tasks.

## Index

| ID | Priority | Task | Depends | Status |
| --- | --- | --- | --- | --- |
| S01 | P0 | OpenCode server service | — | done |
| S02 | P0 | In-app OpenCode UI | S01 | done |
| S03 | P0 | Remove T3 Code | S01, S02 | done |
| S04 | P1 | 3D model skill | — | done |
| S05 | P1 | 3D viewer | — | open |
| S06 | P1 | 3D chat on the same page | S02, S05 | open |
| S07 | P1 | Bug report email | — | done |
| S08 | P2 | JLCPCB client | — | done |
| S09 | P2 | Parts search UI | S08 | done |
| S10 | P2 | Parts search skill | S08 | done |
| S11 | P2 | Order UI and address | S08 | done |
| S12 | — | Educational car kit listing | — | open |
| S13 | — | Car kit digital fulfillment | S12 | open |
| S14 | P2 | Community listings | — | open |

P0 order is S01, then S02, then S03. Do not remove T3 before the replacement exists.

---

## S01 — OpenCode server service

Status: done

### Prompt

```
This session does S01 only. Do not start S02, S03, or any other TODO task. Do not remove T3 Code.

Goal: GPIO-user systemd service that runs OpenCode on loopback, proxied by gpio-companion serve.

Read PRODUCT.md, AGENTS.md, https://opencode.ai/docs/server/ and https://opencode.ai/docs/web/ before coding. Today auth is HTTP basic (OPENCODE_SERVER_USERNAME / OPENCODE_SERVER_PASSWORD). There is no documented custom-auth plugin. Do not invent one.

Bind `opencode web` or `opencode serve` to 127.0.0.1:4096. Mint the password on the Pi the same way the AI device token is minted. Never commit it. gpio-companion serve on :4150 proxies OpenCode HTTP and SSE to loopback and injects basic auth. Dashboard and native apps are out of scope except a signed device route the proxy needs. Unpair/transfer must revoke the proxy immediately. CORS stays loopback-only. Do not publish a public code-<slug> or t3-<slug> hostname. Provider stays http://127.0.0.1:4150/v1/ai, default @cf/zai-org/glm-5.3. Skills stay opencode/skills; preferences stay opencode/preferences.

first-setup enables linger and installs the unit from the GPIO user's home (same user-service pattern as the existing T3 unit, but do not delete T3). Updater runs `opencode upgrade` and restarts this unit without stacking processes.

Done when GET /global/health works through the signed proxy and the browser cannot reach :4096 directly. Mark S01 done in TODO.md. Stop.
```

---

## S02 — In-app OpenCode UI

Status: done

Depends: S01. If the loopback proxy is not in the tree, stop. Do not build the server in this session.

### Prompt

```
This session does S02 only. Do not start S03 or any other TODO task. Do not remove T3 Code.

Goal: replace the need for a T3 iframe on the Open Code path with an in-app session client. Leave T3 files in place until S03.

S01 must already proxy OpenCode at 127.0.0.1:4096 through gpio-companion serve. If that route is missing, stop.

Build a thin session client on web, desktop, and mobile against the proxied OpenAPI (GET/POST /session, POST /session/:id/message, GET /event). Do not iframe opencode web. Do not vendor the upstream web app. Use @opencode-ai/sdk only if it already fits this repo; otherwise fetch the spec. Scope the server to ~/projects/<selected-repo>. Mirror Project → Open Code: session list, prompt, streaming reply, abort. Permission prompts must be shown and answered in-app. Do not expose shell or file routes beyond what the session stream already returns.

EN/FR in packages/core/src/i18n. Electronics-workbench visual. Mirror UX; do not share React files. Browser never calls the Pi.

Done when a signed-in owner can send a prompt to the selected board's OpenCode without a T3 pair code. Mark S02 done in TODO.md. Stop.
```

---

## S03 — Remove T3 Code

Status: done

Depends: S01 and S02. If either is missing, stop. Do not build them in this session.

### Prompt

```
This session does S03 only. Do not start another TODO task.

Goal: remove T3 Code now that OpenCode serve and the in-app UI exist.

Confirm S01 (loopback OpenCode proxy) and S02 (in-app session UI) are already in the tree. If either is missing, stop.

Delete T3 install, pairing, embed, and tunnel from:
- scripts/lib.sh (install_t3code, install_t3_service, configure_t3_opencode_only, update_t3code) and scripts/update-t3.test.ts
- scripts/first-setup.sh, scripts/update-script.sh, scripts/unpair.sh (t3 logout)
- device routes /v1/t3/*, dashboard actions/api/t3.ts, t3-url.ts, t3-embed-proxy, T3Frame, T3PairingPanel, /devices/t3
- desktop and mobile T3 iframe/webview, DeckShell code rail, pair auto-start
- Cloudflare tunnel hostname t3-<slug> → :3773
- PRODUCT.md, documentation/host/*, opencode/preferences/gpio-agent.md, opencode/skills/gpio-companion/SKILL.md

Keep project git, GPIO, flash, run, verify, the AI credit proxy, and the S02 Open Code route. Point every Open Code CTA at that route. Rewrite tests that assumed t3 pair/status. Do not skip them.

Done when first-setup and the updater do not install or start t3, and no UI still embeds https://t3-*.gpio-companion.com. Mark S03 done in TODO.md. Stop.
```

---

## S04 — 3D model skill

Status: done

### Prompt

```
This session does S04 only. Do not build the 3D viewer or the chat dock.

Goal: on-device skill that writes printable parts for the current GitHub project.

Add opencode/skills/gpio-3d/SKILL.md in the same style as opencode/skills/gpio-breadboard/SKILL.md. Output ~/projects/<repo>/model/. Ship glTF (.glb) for the viewer and STL for print. One file per part, plus model/manifest.json with name, file, units (mm), and which board it fits (companion header and/or Arduino Uno/Nano/Mega). Do not use tscircuit for meshes. Do not invent a CAD kernel; write the mesh files and name the tool you used. Feature-branch git rules in opencode/skills/gpio-companion/SKILL.md still apply. Mention gpio-3d from that skill. Do not tell the user to curl loopback.

Done when a sample manifest validates and the skill is linked from gpio-companion/SKILL.md. Mark S04 done in TODO.md. Stop.
```

---

## S05 — 3D viewer

Status: open

Does not require S04. Accept model/*.glb plus model/manifest.json. If no sample exists, use a fixture in tests only.

### Prompt

```
This session does S05 only. Do not write the gpio-3d skill and do not add a chat dock.

Goal: show model/*.glb from the selected project on web, desktop, and mobile, next to the existing PCB and breadboard viewers.

Branch-aware: same branch selector and Reload behavior as pcb/ and breadboard/. Mobile may host the canvas in a WebView at /embed/model the way breadboard does. Do not share React files. Orbit, pan, zoom, fit. List parts from model/manifest.json. No mesh means an empty state, not a fake model. EN/FR in packages/core/src/i18n. Electronics-workbench canvas: no neon, no glass.

Done when opening a project with a glb shows it on all three apps without a new backend origin. Mark S05 done in TODO.md. Stop.
```

---

## S06 — 3D chat on the same page

Status: open

Depends: S02 and S05. If either is missing, stop.

### Prompt

```
This session does S06 only. Do not start another TODO task.

Goal: companion chat on the same Project page as the 3D viewer, for edits to model/.

S02 (in-app OpenCode session client) and S05 (3D viewer) must already exist. If either is missing, stop. Do not build them here.

Add a chat dock on web, desktop, and mobile on that same page. Use the S02 proxied OpenCode session, scoped to the open repo, with a system hint to load skill gpio-3d and edit model/ only. Do not embed T3. Streaming replies stay in the dock. Reload model/manifest.json and the active glb when the session reports a file change, or when the user hits Reload. Do not auto-merge to main. EN/FR. Mirror UX; do not share React files.

Done when a user can ask to move a part and see the updated glb without leaving the page. Mark S06 done in TODO.md. Stop.
```

---

## S07 — Bug report email

Status: done

### Prompt

```
This session does S07 only. Do not start another TODO task.

Goal: signed-in bug report that emails support@gpio-companion.com.

Add the form on Profile for web, desktop, and mobile. Submit goes to dashboard POST /api/support and POST /api/mobile/support. The Worker sends the mail. Load the cloudflare-email-service skill and current Cloudflare docs before wiring the binding. From-address must be a verified Email Sending address on the gpio-companion zone. Body includes user id, optional selected board uuid/model, app surface (web/desktop/mobile), and the user's text. Strip secrets. Rate-limit per user. EN/FR in packages/core/src/i18n. No SMTP credentials on the Pi or in git. Mirror UX; do not share React files.

Done when a test send is covered by a mocked binding and the form does not claim success if the binding is missing. Mark S07 done in TODO.md. Stop.
```

---

## S08 — JLCPCB client

Status: done

Correction 2026-09-29: the JLCPCB application is one dashboard Pages secret set (`JLCPCB_APP_ID`, `JLCPCB_ACCESS_KEY`, `JLCPCB_SECRET_KEY`), not per-user KV and not a Profile form. Shipping address stays on Profile.

### Prompt

```
This session does S08 only. Do not build search UI, the agent skill, or order placement.

Goal: server-side helper around npm @community-jlcpcb/client (https://github.com/shpaw415/community_jlcpcb_api_client).

Read that package's README and types before coding. Call it only from the dashboard Worker. Never from the browser, desktop shell, or mobile app. Store the user's JLCPCB API credentials in dashboard KV using the existing token pattern. Never log them. Missing credentials return 400, not a guessed auth header. No live orders in tests; mock the client.

Done when a Worker helper can search parts with the package and fails closed without credentials. Mark S08 done in TODO.md. Stop.
```

---

## S09 — Parts search UI

Status: done

Depends: S08. If the Worker helper is missing, stop.

### Prompt

```
This session does S09 only. Do not add the agent skill or the order flow.

Goal: parts search panel on Project for web, desktop, and mobile.

S08's Worker helper must already exist. If it does not, stop. Do not add the npm client in this session.

Query, result list (LCSC id, name, package, stock, price if the client returns them), and copy-id. EN/FR. Empty credentials show a Profile link, not a crash. Do not place an order from this panel. Mirror UX; do not share React files.

Done when a signed-in user with credentials can search and a user without credentials cannot hit JLCPCB. Mark S09 done in TODO.md. Stop.
```

---

## S10 — Parts search skill

Status: done

Depends: S08. If the Worker helper is missing, stop.

### Prompt

```
This session does S10 only. Do not build the search UI or the order flow.

Goal: on-device skill that searches JLCPCB parts through the dashboard, not with a key on the Pi.

S08's Worker helper must already exist. If it does not, stop.

Add opencode/skills/gpio-jlcpcb/SKILL.md. The agent calls loopback gpio-companion serve, which proxies to the signed dashboard JLCPCB route. Never put the JLCPCB key on the Pi or in the skill. Return LCSC id, name, package, and stock. Do not order parts. Link the skill from opencode/skills/gpio-companion/SKILL.md. Do not tell the user to curl 127.0.0.1.

Done when the skill refuses to run without a dashboard-side credential. Mark S10 done in TODO.md. Stop.
```

---

## S11 — Order UI and address

Status: done

Depends: S08. Search UI (S09) is not required. If the client helper is missing, stop.

### Prompt

```
This session does S11 only. Do not start another TODO task.

Goal: profile address plus an explicit confirm step before a JLCPCB order.

S08's Worker helper must already exist. If it does not, stop. Do not add the npm client in this session.

Add Profile address (name, line1, line2, city, region, postal code, country) per user in dashboard KV. Reuse the marketplace CheckoutAddress validation shape; do not fork a second address grammar. Add an order review step on web, desktop, and mobile that uses @community-jlcpcb/client only through the Worker. Read the client docs and implement only methods that exist (PCB assembly and 3D print only if the client exposes them). Require an explicit confirm. Do not submit a live order in tests. EN/FR. Mirror UX; do not share React files.

Done when confirm is impossible without an address and a JLCPCB credential, and cancel does not create an order. Mark S11 done in TODO.md. Stop.
```

---

## S12 — Educational car kit listing

Status: open

### Prompt

```
This session does S12 only. Do not fulfill GitHub repos, credits, or 3D files.

Goal: marketplace draft listing for the kids/beginners Educational Car kit.

Add slug educational-car-kit, SKU GPIO-EDU-CAR, in apps/marketplace. EN/FR in apps/marketplace/src/i18n. Status draft. Do not invent a price; leave priceCents null until the user locks one. Description: kids/beginners car kit. Copy must say that a paid order creates a GitHub repo (fulfillment is S13, not this session). Parts to list: directional frame, custom socket so an Arduino or the companion board mounts on the frame, motors plus controller, IR proximity emitter/receiver pair for collision detection. Follow the existing starter-kit seed and /kits/[slug] page. Do not mark it purchasable while priceCents is null.

Done when /kits/educational-car-kit renders the parts list in EN and FR and checkout rejects it as not for sale. Mark S12 done in TODO.md. Stop.
```

---

## S13 — Car kit digital fulfillment

Status: open

Depends: S12. If the listing is missing, stop. Do not invent a price. If priceCents is still null, implement the fulfillment function and tests with a fixture order, but do not enable live checkout.

### Prompt

```
This session does S13 only. Do not build the 3D viewer or community listings.

Goal: one-time digital fulfillment when a paid order contains educational-car-kit.

S12's listing must already exist. If it does not, stop. Do not invent a price. If priceCents is null, keep checkout disabled and test fulfillment against a fixture paid order.

On captured payment, fulfill once, idempotent on order id:
1. Create a private GitHub repo on the buyer's connected GitHub account via the existing GitHub App. Name edu-car-<orderId>. Write .gpio-companion, a breadboard/ stub, and model/ with a car glb, stl, and manifest (name, file, units mm, companion header and Arduino socket). If GitHub is not connected, mark fulfillment pending. Do not create a repo under a gpio-companion org.
2. Commit an OpenViking seed file the on-device agent can import: kit parts and the collision-IR plus motors goal. Do not invent extra memory.
3. Grant $10 AI credits with the dashboard grantUsd path (10_000_000 micros), idempotent on order id. Do not double-grant on webhook retry.

Done when a replayed capture does not create a second repo or a second credit grant. Mark S13 done in TODO.md. Stop.
```

---

## S14 — Community listings

Status: open

### Prompt

```
This session does S14 only. Do not start another TODO task. Do not invent the platform fee.

Goal: a signed-in user can publish a gpio-companion GitHub project for sale. gpio-companion keeps a percentage. The percentage is not locked.

Read MARKETPLACE_FEE_BPS from the Worker env. If it is missing, publishing may be drafted but checkout of community listings must fail closed. Do not hardcode a guessed bps. Record fee and seller net on the order. Do not build a PayPal split or payout.

Listing fields: title, EN/FR description, price, optional model/pcb preview, source GitHub repo. Admin can unpublish. EN/FR in apps/marketplace/src/i18n.

Done when a community listing cannot be bought without MARKETPLACE_FEE_BPS, and a sale ledger row shows fee and seller net. Mark S14 done in TODO.md. Stop.
```
