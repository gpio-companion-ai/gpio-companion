---
name: gpio-ui
description: >-
  Show things to the user on the open gpio-companion dashboard app (web,
  desktop, or mobile): navigate, open a dock panel, open/close the command
  palette, toast, and ask a modal question. Signed /v1/ui WebSocket channel;
  the agent posts unsigned to loopback only. Use after starting or flashing so
  the user can watch. Not DeviceHub. Never start sketches, flash, unpair,
  delete, order, or change WiFi through this channel.
---

# gpio-ui

Push a small, closed set of commands to whichever dashboard app the user has
open on this board. The app holds a signed `wss://api-<slug>.gpio-companion.com/v1/ui`
WebSocket; you call the board's loopback HTTP. You call loopback yourself.
**Never** tell the user to curl it.

## Check who is listening

```sh
curl -s http://127.0.0.1:4150/v1/ui
```

`{ sockets: [{ id, surface: "web"|"desktop"|"mobile", focused }] }` — an empty
list means no dashboard app is open. Only deliver UI when this is non-empty.

## Send commands

```sh
curl -s -X POST http://127.0.0.1:4150/v1/ui \
  -H 'content-type: application/json' \
  -d '{"type":"toast","text":"Blink is running on pin 7"}'
```

Response: `{ "delivered": 1, "fallback": false }`.

- `delivered: 0` → the dashboard is not open. Say so in chat and move on; do
  not retry-spam.
- `fallback: true` → an app is open but not in the foreground (background
  phone, unfocused window). The command still arrived there.

## Commands

| Type | Body | Effect |
| --- | --- | --- |
| `navigate` | `{"type":"navigate","target":"project"}` | Jump to a known place |
| `dock` | `{"type":"dock","tab":"console"}` | Open the bottom dock on console, gpio, flash, or problems |
| `palette` | `{"type":"palette","open":true}` | Open or close the command palette |
| `toast` | `{"type":"toast","text":"..."}` | Short text (max 160 chars) |
| `modal` | see below | Title + body + up to 3 buttons, waits for a click |

Known `navigate` targets (unknown ones are ignored): `project`, `code`,
`docs`, `devices`, `pair`, `wifi`, `keys`, `requests`, `debug`, `admin`,
`profile`, `github`, `credits`. `debug` and `admin` do nothing in Easy mode or
for a non-admin. The channel never flips Easy/Expert.

Caps: title 80, body 500, button label 40, toast 160 characters. No URLs, no
HTML, no script — plain text only. Up to 8 app sockets; extra ones are
refused.

## Modal questions

```sh
ID=$(curl -s -X POST http://127.0.0.1:4150/v1/ui \
  -H 'content-type: application/json' \
  -d '{"type":"modal","id":"ask-blink-7","title":"Light up pin 7?","body":"I want to blink the LED on physical pin 7 for 30 seconds.","buttons":["Yes","No"]}' >/dev/null; echo ask-blink-7)
curl -s http://127.0.0.1:4150/v1/ui/reply/ask-blink-7
```

- Generate a fresh `id` per modal (e.g. `ask-<kebab>-<n>`).
- Poll `GET /v1/ui/reply/<id>` until it returns `{"action":"<label>"}` (one of
  your button labels, or `"dismiss"` if the user closed it). Each call waits
  up to ~25 s; poll again if you got `404 {"error":"no reply"}` and the user
  may still answer. Replies are kept for 2 minutes.
- When `delivered` was 0, do not wait on a reply — nobody saw the modal.

## What this channel is for

Open the matching dock so the user can watch hardware you already started:

- Started a host sketch with `/v1/run` → `dock` `console` (live Serial).
- Flashing with `/v1/flash` → `dock` `flash`.
- Circuit verify `/v1/verify` → `dock` `problems`.
- Live GPIO work → `dock` `gpio`.
- Ask permission with `modal`; confirm small completions with `toast`.

This channel **never** starts a sketch, flashes, unpairs, deletes a project,
orders parts, or changes WiFi. Hardware goes through `POST /v1/run`,
`POST /v1/flash`, and the other device APIs. The dashboard palette has its own
armed flow for user-initiated actions; do not imitate it.

Unsigned loopback only, no Ed25519 headers. Dashboard-signed calls share the
route, but the agent never signs anything.
