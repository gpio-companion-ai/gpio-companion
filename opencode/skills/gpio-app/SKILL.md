---
name: gpio-app
description: >-
  Serve a custom Bun web app from this board's project repo so the user can
  use it on the dashboard, desktop, or mobile: create app/<name>/ with a
  package.json (name = kebab id) and a server.ts that binds 127.0.0.1 on
  GPIO_APP_PORT; `gpio-companion app start --repo <repo> --dir <name>`, then
  `gpio-companion app list` / `ui app --id <name> --view split|modal|page`.
  One app at a time. Users can also start/stop it from the dashboard (Project
  → Custom server, dock → actions). Not for pin control itself — hardware
  still goes through sketch run / flash / gpio CLI.
---

# gpio-app

Serve a small custom Bun app for this project and open it in the user's
gpio-companion app (web, desktop, or mobile). The app is proxied through the
companion device API over a signed, short-lived frame URL — the browser never
holds board credentials.

## App project layout

Create the app inside the project checkout:

```
~/projects/<repo>/app/<name>/
├── package.json   {"name": "<kebab-id>"}
└── server.ts
```

- `package.json` is required; its `name` is the app id users and the dashboard
  see (kebab-case, ≤64 chars, not `start`/`stop`/`list`/`frame`).
- Entry resolution: `package.json` `main` if it exists, else `server.ts`, else
  `index.ts`.

```ts
// ~/projects/<repo>/app/led-panel/server.ts
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
- Commit the app with the project (feature-branch rules apply).

## Start, show, stop

You run board commands yourself. Never tell the user board commands.

```sh
gpio-companion app list
gpio-companion app start --repo blink-led --dir led-panel
```

- `--dir` is the folder name under `app/` in that repo.
- The reply includes the app `name` (from package.json) and `port`. If start
  fails, read `gpio-companion app status` — the log tail says why (missing
  package.json, no entry file, wrong port, crashed).
- **One app at a time.** A second `app start` returns 409 until
  `gpio-companion app stop`.
- The user can also start/stop the app from the dashboard without you:
  **Project → Custom server** (pick the app, Start server, Open), and the
  dock actions tab has **Stop custom server**. If the user started it, just
  open it with `ui app`.

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
