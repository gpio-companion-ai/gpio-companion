---
name: gpio-app
description: >-
  Serve a custom Bun web app from this board's project repo so the user can
  use it on the dashboard, desktop, or mobile: write app/<name>/server.ts
  (bind 127.0.0.1 on GPIO_APP_PORT), `gpio-companion app start --repo <repo>
  --name <kebab> --entry app/<name>/server.ts`, then show it with
  `gpio-companion ui app --id <name> --view split|modal|page`. One app at a
  time. `app stop` when done. Use for custom panels, controls, and live views
  the chat cannot express. Not for pin control itself — hardware still goes
  through sketch run / flash / gpio CLI.
---

# gpio-app

Serve a small custom Bun app for this project and open it in the user's
gpio-companion app (web, desktop, or mobile). The app is proxied through the
companion device API over a signed, short-lived frame URL — the browser never
holds board credentials.

## Server contract

Write the server in the project checkout:

```
~/projects/<repo>/app/<name>/server.ts
```

```ts
const port = Number(process.env.GPIO_APP_PORT ?? 0);
Bun.serve({
	port,
	hostname: "127.0.0.1",
	fetch(req) {
		const url = new URL(req.url);
		if (url.pathname === "/") {
			return new Response("<h1>LED panel</h1>", {
				headers: { "content-type": "text/html" },
			});
		}
		if (url.pathname === "/api/state") {
			return Response.json({ ok: true });
		}
		return new Response("not found", { status: 404 });
	},
});
console.log(`app listening on ${port}`);
```

Rules:

- **Bind `127.0.0.1` on `GPIO_APP_PORT`** — the companion server picks the
  port and probes it. Listening on `0.0.0.0` or a fixed port breaks the proxy.
- Serve HTML at `/`; extra paths, POST actions, SSE, and websockets all pass
  through the proxy (path prefix carries the auth token automatically — use
  relative URLs in the page).
- Keep state server-side or in the URL; the frame reloads when its access
  token renews (about every 10 minutes idle).
- The app runs as this GPIO user. Reading project files is fine; do not touch
  `/etc`, pairing, or secrets. Hardware still goes through the board CLI /
  sketches — this channel is UI, not pin control.
- Only `.ts`/`.js` entry files under the repo. `bun` is already installed.

## Start, show, stop

You run board commands yourself. Never tell the user board commands.

```sh
gpio-companion app start --repo blink-led --name led-panel --entry app/led-panel/server.ts
```

- `--repo` is the GitHub repo name (the `~/projects/<repo>` checkout).
- `--name` is kebab-case, ≤64 chars, not `start`/`stop`/`frame`.
- Reply includes `port`. If start fails, read `gpio-companion app status` —
  the log tail says why (missing file, wrong port, crashed).
- **One app at a time.** A second `app start` returns 409 until
  `gpio-companion app stop`.

Then open it for the user (skill `gpio-ui`; check `ui list` first — when no
app is open, say so once and move on):

```sh
gpio-companion ui app --id led-panel --view split --title "LED panel"
```

| View | Opens where |
| --- | --- |
| `split` (default) | Code view middle pane — beside the file tree and chat; keeps the session mounted |
| `modal` | Dialog over the current page |
| `page` | Full-page view (`/devices/app` on web; full-screen window/sheet on desktop and mobile) |

Stop it when the user is done (or before replacing it):

```sh
gpio-companion app stop
```

Stopping also closes every open frame. The app is stopped automatically when
the companion server restarts (Update companion) — restart it and re-open if
the user still needs it.

## When to use it

- A custom control panel or live readout the chat transcript cannot express
  (sliders, charts, dashboards, wizards for this project).
- A custom action surface: buttons/forms POSTing to your app, which then calls
  board endpoints through your own server-side code.
- Not for breadboard/PCB viewers (Project already renders those), not for pin
  control (use the C-first flow), not for anything the `gpio-ui` dock already
  shows (console, Live GPIO, flash, problems).
