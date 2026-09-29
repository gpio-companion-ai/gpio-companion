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

const dir = await mkdtemp(join(tmpdir(), "gpio-ai-proxy-"));
const keys = await generateDeviceKeyPair();
const hits: string[] = [];

const server = startDeviceApi({
	port: 0,
	hostname: "127.0.0.1",
	store: fileConfigStore(join(dir, "config.json"), "orangepi"),
	secrets: fileSecretsStore(join(dir, "secrets.env")),
	pairing: filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
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
	fetchImpl: async (input) => {
		const url = String(input);
		hits.push(url);
		if (url.endsWith("/api/ai/credentials")) {
			return Response.json({
				token: "gpioai.v1.test",
				expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
			});
		}
		if (url.endsWith("/api/ai/v1/models")) {
			return Response.json({ object: "list", data: [{ id: "glm" }] });
		}
		if (url.endsWith("/api/ai/v1/chat/completions")) {
			return Response.json({ id: "chat-1", object: "chat.completion" });
		}
		return new Response("missing", { status: 404 });
	},
});

afterAll(() => {
	server.stop();
	forgetAiCredentials("pair-uuid");
});

describe("loopback ai proxy", () => {
	test("forwards models without a device signature", async () => {
		const response = await fetch(`${server.url}v1/ai/models`);
		expect(response.status).toBe(200);
		const body = (await response.json()) as { object: string };
		expect(body.object).toBe("list");
		expect(hits.some((url) => url.endsWith("/api/ai/credentials"))).toBe(true);
		expect(hits.some((url) => url.endsWith("/api/ai/v1/models"))).toBe(true);
	});

	test("forwards chat completions", async () => {
		const response = await fetch(`${server.url}v1/ai/chat/completions`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ model: "glm", messages: [] }),
		});
		expect(response.status).toBe(200);
		const body = (await response.json()) as { id: string };
		expect(body.id).toBe("chat-1");
	});

	test("rejects the ai proxy off loopback", async () => {
		await expect(
			handleDeviceRequest(
				new Request("https://api.example/v1/ai/models"),
				fileConfigStore(join(dir, "config.json"), "orangepi"),
				fileSecretsStore(join(dir, "secrets.env")),
				filePairingStore(join(dir, "pairing.json"), "pair-uuid", "pair-key"),
				async () => undefined,
				undefined,
				{ keyId: keys.keyId, publicKeyPem: keys.publicKeyPem },
			),
		).rejects.toThrow("ai proxy is local-only");
	});
});
