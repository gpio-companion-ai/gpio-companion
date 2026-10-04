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
// ~/projects/<repo>/app/thermostat/server.ts
const state = { targetC: 21, currentC: 20.5 };
const sockets = new Set<WebSocket>();

function broadcast() {
	const message = JSON.stringify(state);
	for (const socket of sockets) {
		socket.send(message);
	}
}

function html() {
	return `<!doctype html>
<html>
<body>
	<pre id="out"></pre>
	<script>
		const url = new URL("ws", location.href);
		url.protocol = location.protocol === "https:" ? "wss:" : "ws:";
		const socket = new WebSocket(url);
		socket.onmessage = (event) => {
			document.getElementById("out").textContent = event.data;
		};
		async function setTarget(targetC) {
			await fetch("api/target", {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ targetC }),
			});
		}
	</script>
</body>
</html>`;
}

const port = Number(process.env.GPIO_APP_PORT ?? 0);
Bun.serve({
	port,
	hostname: "127.0.0.1",
	websocket: {
		open(ws) {
			sockets.add(ws);
			ws.send(JSON.stringify(state));
		},
		close(ws) {
			sockets.delete(ws);
		},
	},
	async fetch(req, server) {
		const url = new URL(req.url);
		if (url.pathname === "/") {
			return new Response(html(), {
				headers: { "content-type": "text/html" },
			});
		}
		if (url.pathname === "/ws" && server.upgrade(req)) {
			return;
		}
		if (url.pathname === "/api/target" && req.method === "POST") {
			const body = (await req.json()) as { targetC?: number };
			if (typeof body.targetC === "number") state.targetC = body.targetC;
			broadcast();
			return Response.json({ ok: true });
		}
		return new Response("not found", { status: 404 });
	},
});
console.log(`app listening on ${port}`);
```

The page connects document-relative and never polls: `new URL("ws",
location.href)` lands inside the frame path (the access token rides it), then
only the protocol is swapped to `wss:`/`ws:`. State arrives on connect and on
every change; the only other request is the one-shot `POST api/target`.

Rules:

- **Bind `127.0.0.1` on `GPIO_APP_PORT`** — the companion server picks the
  port and probes it. Listening on `0.0.0.0` or a fixed port breaks the proxy.
- **Live state is WebSocket push, never polling.** Anything that changes over
  time (sensor reads, pin state, counters, progress) is served by a
  `websocket` handler on the same `Bun.serve`: send the full state on open and
  broadcast again on every change; the page renders pushed messages. The proxy
  bridges websocket upgrades browser⇄app end-to-end. Do not `setInterval`
  `fetch` a state endpoint — that is blocked by design. The initial page load
  and one-shot actions are the only HTTP.
- **HTTP is the page + one-shot actions.** Buttons/sliders POST to relative
  paths (`fetch("api/target", …)`). The frame is sandboxed (origin `null`), so
  the proxy answers CORS for you (`Access-Control-Allow-Origin: *`, OPTIONS
  preflight) — do not set your own CORS headers and never use
  `credentials: "include"`; the access token rides the URL path.
- Keep state server-side or in the URL; the frame reloads when its access
  token renews (about every 10 minutes idle) and the socket reconnects.
- The app runs as this GPIO user. Reading project files is fine; do not touch
  `/etc`, pairing, or secrets. Hardware still goes through the board CLI /
  sketches — this channel is UI, not pin control.
- Commit the app with the project (feature-branch rules apply).

## Start, show, stop

You run board commands yourself. Never tell the user board commands.

```sh
gpio-companion app list
gpio-companion app start --repo blink-led --dir thermostat
```

- `--dir` is the folder name under `app/` in that repo.
- The reply includes the app `name` (from package.json) and `port`. If start
  fails, read `gpio-companion app status` — the log tail says why (missing
  package.json, no entry file, wrong port, crashed).
- **One app at a time.** A second `app start` returns 409 until
  `gpio-companion app stop`.
- The user can also start/stop the app from the dashboard without you:
  **Project → Custom server** (pick the app, Start server, Open), the
  dock actions tab has **Stop custom server**, and in the Code page file
  explorer a long-press / right-click on the app's `app/<name>` folder offers
  Start app, Stop app, Open in preview, and Open in full screen. If the user
  started it, just open it with `ui app`.

Then open it for the user (skill `gpio-ui`; check `ui list` first — when no
app is open, say so once and move on):

```sh
gpio-companion ui app --id thermostat --view split --title "Thermostat"
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
