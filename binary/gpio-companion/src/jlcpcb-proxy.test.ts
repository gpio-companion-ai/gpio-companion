import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateDeviceKeyPair } from "gpio-companion";
import { forgetAiCredentials } from "./ai-credentials.ts";
import { memoryArduinoProxy } from "./arduino-proxy.ts";
import { memoryFlash } from "./flash.ts";
import { createGpioController, memoryGpioBackend } from "./gpio.ts";
import { filePairingStore } from "./pairing.ts";
import { memoryRun } from "./run.ts";
import { fileSecretsStore } from "./secrets.ts";
import { handleDeviceRequest, startDeviceApi } from "./serve.ts";
import { fileConfigStore } from "./store.ts";

const dir = await mkdtemp(join(tmpdir(), "gpio-jlcpcb-proxy-"));
const keys = await generateDeviceKeyPair();
const hits: Array<{ url: string; init?: RequestInit }> = [];
const SECRET = "jlc-secret-do-not-leak";

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(dir, "config.json"), "orangepi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(
		join(dir, "pairing.json"),
		"jlcpcb-pair",
		"pair-key",
	),
	applyTunnel: async () => undefined,
	gpio: createGpioController(memoryGpioBackend("")),
	flash: memoryFlash(),
	run: memoryRun(),
	proxy: memoryArduinoProxy(),
	deviceAuth: {
		keyId: keys.keyId,
		publicKeyPem: keys.publicKeyPem,
	},
	dashboardUrl: "https://gpio-companion.com",
	fetchImpl: async (input, init) => {
		const url = String(input);
		hits.push({ url, init });
		if (url.endsWith("/api/ai/credentials")) {
			return Response.json({
				token: "gpioai.v1.test",
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			});
		}
		if (url.endsWith("/api/jlcpcb/device")) {
			const method = init?.method ?? "GET";
			if (method === "GET") {
				return Response.json({
					ok: true,
					data: { configured: false },
				});
			}
			const forwarded = String(init?.body ?? "");
			if (forwarded.includes(SECRET)) {
				return Response.json({ error: "secret forwarded" }, { status: 500 });
			}
			return Response.json(
				{
					ok: false,
					error: "jlcpcb credentials required",
					secretKey: SECRET,
				},
				{ status: 400 },
			);
		}
		return new Response("missing", { status: 404 });
	},
});

afterAll(() => {
	server.stop();
	forgetAiCredentials("jlcpcb-pair");
});

describe("loopback jlcpcb proxy", () => {
	test("forwards status with the device token and no signature", async () => {
		const response = await fetch(`${server.url}v1/jlcpcb`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as {
			data: { configured: boolean };
		};
		expect(body.data.configured).toBe(false);
		const device = hits.find((hit) => hit.url.endsWith("/api/jlcpcb/device"));
		expect(device?.init?.method).toBe("GET");
		const headers = new Headers(device?.init?.headers);
		expect(headers.get("authorization")).toBe("Bearer gpioai.v1.test");
	});

	test("passes a credential refusal through and strips secrets", async () => {
		const response = await fetch(`${server.url}v1/jlcpcb`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				componentCodes: ["C2040"],
				secretKey: SECRET,
			}),
		});
		expect(response.status).toBe(400);
		const text = await response.text();
		expect(text).toContain("jlcpcb credentials required");
		expect(text).not.toContain(SECRET);
		const device = hits.filter((hit) => hit.url.endsWith("/api/jlcpcb/device"));
		const posted = device.at(-1);
		expect(String(posted?.init?.body)).not.toContain(SECRET);
		expect(String(posted?.init?.body)).toContain("C2040");
	});

	test("rejects the jlcpcb proxy off loopback", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/jlcpcb"),
				fileConfigStore(join(dir, "config.json"), "orangepi"),
				fileSecretsStore(join(dir, "secrets.env")),
				filePairingStore(join(dir, "pairing.json"), "jlcpcb-pair", "pair-key"),
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
			),
		).rejects.toThrow("jlcpcb proxy is local-only");
	});
});

describe("gpio-jlcpcb skill", () => {
	test("refuses without a dashboard credential and does not order", async () => {
		const root = `${import.meta.dir}/../../..`;
		const skill = await Bun.file(
			`${root}/opencode/skills/gpio-jlcpcb/SKILL.md`,
		).text();
		const parent = await Bun.file(
			`${root}/opencode/skills/gpio-companion/SKILL.md`,
		).text();
		expect(skill).toContain("data.configured");
		expect(skill).toContain("jlcpcb credentials required");
		expect(skill).toContain("Pages secrets");
		expect(skill).not.toContain("Profile → JLCPCB");
		expect(skill).toContain("Never");
		expect(skill).not.toContain("secretKey:");
		expect(skill.toLowerCase()).not.toContain("place an order");
		expect(skill).toContain("Do not");
		expect(skill).toContain("Order");
		expect(parent).toContain("gpio-jlcpcb");
	});
});
