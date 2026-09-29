import { describe, expect, test } from "bun:test";
import {
	handleSupport,
	SUPPORT_FROM,
	SUPPORT_RATE_MAX,
	SUPPORT_TO,
	type SupportEmail,
	stripSecrets,
	supportAccepted,
	supportResponse,
} from "./support.ts";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
}

function env(email?: SupportEmail) {
	return {
		DYNAMIC_PAGE_KV: new MemoryKv() as unknown as KVNamespace,
		EMAIL: email,
	};
}

describe("support", () => {
	test("strips secrets before they can be mailed", () => {
		const raw =
			"token=ghp_abcdefghijklmnopqrstuvwxyz password: hunter2 Bearer gpioai.v1.secret GPIO_COMPANION_PAIRING_KEY=abc123 eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.signature";
		const stripped = stripSecrets(raw);
		expect(stripped).not.toContain("ghp_");
		expect(stripped).not.toContain("hunter2");
		expect(stripped).not.toContain("gpioai.v1");
		expect(stripped).not.toContain("abc123");
		expect(stripped).not.toContain("eyJhbGci");
		expect(stripped).toContain("[redacted]");
	});

	test("sends a mocked binding and does not claim success without one", async () => {
		const sent: unknown[] = [];
		const binding: SupportEmail = {
			async send(message) {
				sent.push(message);
				return { messageId: "msg-1" };
			},
		};
		const result = await handleSupport({
			env: env(binding),
			userId: "user-1",
			userEmail: "owner@example.com",
			now: 1_000,
			body: {
				surface: "web",
				text: "blink failed token=ghp_supersecretvalue",
				boardUuid: "11111111-1111-4111-8111-111111111111",
				boardModel: "Orange Pi 3 LTS",
			},
		});
		expect(supportAccepted(result)).toBe(true);
		expect(sent).toHaveLength(1);
		const message = sent[0] as {
			to: string;
			from: { email: string };
			text: string;
		};
		expect(message.to).toBe(SUPPORT_TO);
		expect(message.from.email).toBe(SUPPORT_FROM);
		expect(message.text).toContain("User: user-1");
		expect(message.text).toContain("Surface: web");
		expect(message.text).toContain("11111111-1111-4111-8111-111111111111");
		expect(message.text).toContain("Orange Pi 3 LTS");
		expect(message.text).toContain("blink failed");
		expect(message.text).not.toContain("ghp_");
		await expect(
			handleSupport({
				env: env(),
				userId: "user-1",
				userEmail: null,
				body: { surface: "desktop", text: "no binding" },
			}),
		).rejects.toThrow("support email is not configured");
		expect(supportAccepted(null)).toBe(false);
		expect(supportAccepted({})).toBe(false);
		const missing = await supportResponse(() =>
			handleSupport({
				env: env(),
				userId: "user-1",
				userEmail: null,
				body: { surface: "web", text: "binding missing" },
			}),
		);
		expect(missing.status).toBe(503);
		const body = (await missing.json()) as {
			ok: boolean;
			error: string;
		};
		expect(body).toEqual({
			ok: false,
			error: "support email is not configured",
		});
	});

	test("rate-limits per user and does not send when the binding throws", async () => {
		let calls = 0;
		const binding: SupportEmail = {
			async send() {
				calls += 1;
				if (calls === 1) {
					throw new Error("E_SENDER_NOT_VERIFIED");
				}
				return { messageId: "ok" };
			},
		};
		const shared = env(binding);
		await expect(
			handleSupport({
				env: shared,
				userId: "user-2",
				userEmail: null,
				now: 5_000,
				body: { surface: "mobile", text: "first" },
			}),
		).rejects.toThrow("support email is not configured");
		for (let i = 0; i < SUPPORT_RATE_MAX; i += 1) {
			await handleSupport({
				env: shared,
				userId: "user-2",
				userEmail: null,
				now: 10_000 + i,
				body: { surface: "mobile", text: `report ${i}` },
			});
		}
		await expect(
			handleSupport({
				env: shared,
				userId: "user-2",
				userEmail: null,
				now: 20_000,
				body: { surface: "mobile", text: "too many" },
			}),
		).rejects.toThrow("too many bug reports");
	});
});
