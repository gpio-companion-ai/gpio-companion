import { describe, expect, test } from "bun:test";
import { type CliIo, run } from "./cli.ts";

type Call = { url: string; init: RequestInit };

function harness(
	responses:
		| Array<{ status?: number; body?: unknown }>
		| { status?: number; body?: unknown },
) {
	const calls: Call[] = [];
	const out: string[] = [];
	const err: string[] = [];
	const queue = Array.isArray(responses) ? [...responses] : [responses];
	const io: CliIo = {
		cwd: "/home/companion/projects/demo",
		stdout: (line) => out.push(line),
		stderr: (line) => err.push(line),
		env: {},
		fetchImpl: async (input, init = {}) => {
			calls.push({ url: String(input), init });
			const next = queue.shift() ?? { body: {} };
			const status = next.status ?? 200;
			return new Response(JSON.stringify(next.body ?? {}), { status });
		},
	};
	return { calls, out, err, io };
}

describe("gpio-companion board CLI", () => {
	test("sketch run posts absolute dir", async () => {
		const h = harness({ body: { started: true } });
		const code = await run(["sketch", "run", "--path", "host/blink"], h.io);
		expect(code).toBe(0);
		expect(h.calls).toHaveLength(1);
		expect(h.calls[0]?.url).toBe("http://127.0.0.1:4150/v1/run");
		const body = JSON.parse(h.calls[0]?.init.body as string) as { dir: string };
		expect(body.dir).toBe("/home/companion/projects/demo/host/blink");
		expect(h.out.join("\n")).toContain("started");
	});

	test("sketch run requires --path", async () => {
		const h = harness({ body: {} });
		const code = await run(["sketch", "run"], h.io);
		expect(code).toBe(1);
		expect(h.calls).toHaveLength(0);
	});

	test("sketch status / stop / list hit loopback paths", async () => {
		let h = harness({ body: { running: false, log: "", last: null } });
		expect(await run(["sketch", "status"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/run");

		h = harness({ body: { stopped: true } });
		expect(await run(["sketch", "stop"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/run/stop");

		h = harness({ body: { sketches: [{ name: "blink" }] } });
		expect(await run(["sketch", "list"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/run/sketches");
		expect(h.out.join("\n")).toContain("blink");
	});

	test("proxy status reports connected board", async () => {
		const h = harness({
			body: {
				connected: true,
				board: "mega",
				fqbn: "arduino:avr:mega",
				port: "/dev/ttyACM0",
			},
		});
		expect(await run(["proxy", "status"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/arduino-proxy");
		expect(h.out.join("\n")).toContain("mega");
	});

	test("gpio set posts physical/dir/value", async () => {
		const h = harness({ body: { ok: true } });
		expect(
			await run(
				["gpio", "set", "--physical", "7", "--dir", "out", "--value", "1"],
				h.io,
			),
		).toBe(0);
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({ physical: 7, dir: "out", value: 1 });
	});

	test("gpio tone posts tone op", async () => {
		const h = harness({ body: { ok: true } });
		expect(
			await run(["gpio", "tone", "--physical", "7", "--hz", "440"], h.io),
		).toBe(0);
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({ physical: 7, op: "tone", hz: 440 });
	});

	test("flash start posts fqbn and absolute dir", async () => {
		const h = harness({ body: { started: true } });
		expect(
			await run(
				[
					"flash",
					"start",
					"--fqbn",
					"arduino:avr:uno",
					"--path",
					"firmware/blink",
				],
				h.io,
			),
		).toBe(0);
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body.fqbn).toBe("arduino:avr:uno");
		expect(body.dir).toBe("/home/companion/projects/demo/firmware/blink");
	});

	test("flash proxy with no flags posts empty object", async () => {
		const h = harness({ body: { started: true } });
		expect(await run(["flash", "proxy"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/flash/proxy");
	});

	test("verify start posts repo", async () => {
		const h = harness({ body: { started: true } });
		expect(await run(["verify", "start", "--repo", "demo"], h.io)).toBe(0);
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({ repo: "demo" });
	});

	test("console usb-start posts port", async () => {
		const h = harness({ body: { started: true } });
		expect(
			await run(["console", "usb-start", "--port", "/dev/ttyACM0"], h.io),
		).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/console/usb");
	});

	test("ui toast posts toast command", async () => {
		const h = harness({ body: { delivered: 1, fallback: false } });
		expect(await run(["ui", "toast", "--text", "Blink is running"], h.io)).toBe(
			0,
		);
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({ type: "toast" });
	});

	test("ui reply polls encoded id", async () => {
		const h = harness({ body: { action: "Yes" } });
		expect(await run(["ui", "reply", "--id", "ask-1"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/ui/reply/ask-1");
	});

	test("ui app posts app command", async () => {
		const h = harness({ body: { delivered: 1, fallback: false } });
		expect(
			await run(
				[
					"ui",
					"app",
					"--id",
					"led-panel",
					"--view",
					"modal",
					"--title",
					"LED Panel",
				],
				h.io,
			),
		).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/ui");
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({
			type: "app",
			appId: "led-panel",
			view: "modal",
			title: "LED Panel",
		});
	});

	test("app start posts repo, name, entry", async () => {
		const h = harness({
			body: { started: true, name: "led-panel", port: 4600 },
		});
		expect(
			await run(
				[
					"app",
					"start",
					"--repo",
					"demo",
					"--name",
					"led-panel",
					"--entry",
					"app/led-panel/server.ts",
				],
				h.io,
			),
		).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/app/start");
		const body = JSON.parse(h.calls[0]?.init.body as string) as Record<
			string,
			unknown
		>;
		expect(body).toMatchObject({
			repo: "demo",
			name: "led-panel",
			entry: "app/led-panel/server.ts",
		});
		expect(h.out.join("\n")).toContain("port=4600");
	});

	test("app status and stop hit loopback", async () => {
		let h = harness({
			body: { running: true, name: "led-panel", port: 4600, log: "" },
		});
		expect(await run(["app", "status"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/app");
		expect(h.out.join("\n")).toContain("running name=led-panel");

		h = harness({ body: { stopped: true } });
		expect(await run(["app", "stop"], h.io)).toBe(0);
		expect(h.calls[0]?.url).toEndWith("/v1/app/stop");
	});

	test("API error surfaces stderr and exit 1", async () => {
		const h = harness({ status: 409, body: { error: "run already running" } });
		const code = await run(["sketch", "run", "--path", "/tmp/a"], h.io);
		expect(code).toBe(1);
		expect(h.err.join("\n")).toContain("already running");
	});

	test("group --help prints help with exit 0", async () => {
		const h = harness({ body: {} });
		expect(await run(["sketch", "--help"], h.io)).toBe(0);
		expect(h.calls).toHaveLength(0);
		expect(h.out.join("\n")).toContain("sketch run --path");
	});

	test("--json prints raw payload", async () => {
		const h = harness({ body: { running: true, log: "hi" } });
		expect(await run(["sketch", "status", "--json"], h.io)).toBe(0);
		expect(JSON.parse(h.out.join("\n"))).toMatchObject({ running: true });
	});
});
