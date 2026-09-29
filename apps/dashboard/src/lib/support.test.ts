import { describe, expect, test } from "bun:test";
import {
	handleSupport,
	SUPPORT_FROM,
	SUPPORT_RATE_MAX,
	SUPPORT_TO,
	stripSecrets,
	supportAccepted,
	supportResponse,
	type SupportEnv,
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

type SentCall = {
	url: string;
	authorization: string;
	body: Record<string, unknown>;
};

function env(overrides?: Partial<SupportEnv>): SupportEnv {
	return {
		DYNAMIC_PAGE_KV: new MemoryKv() as unknown as KVNamespace,
		CLOUDFLARE_ACCOUNT_ID: "",
		CLOUDFLARE_EMAIL_API_TOKEN: "",
		...overrides,
	};
}

function configuredEnv(kv?: MemoryKv): SupportEnv {
	return env({
		DYNAMIC_PAGE_KV: (kv ?? new MemoryKv()) as unknown as KVNamespace,
		CLOUDFLARE_ACCOUNT_ID: "account-1",
		CLOUDFLARE_EMAIL_API_TOKEN: "token-1",
	});
}

function delivery(to: string, queued = false) {
	return {
		success: true,
		result: {
			delivered: queued ? [] : [to],
			permanent_bounces: [],
			queued: queued ? [to] : [],
		},
	};
}

function mockFetch(
	handler: (call: number) => Response,
): { fetch: typeof fetch; calls: SentCall[] } {
	const calls: SentCall[] = [];
	const fetchImpl = (async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		const headers = new Headers(init?.headers);
		calls.push({
			url: String(input),
			authorization: headers.get("Authorization") ?? "",
			body: JSON.parse(String(init?.body)) as Record<string, unknown>,
		});
		return handler(calls.length);
	}) as unknown as typeof fetch;
	return { fetch: fetchImpl, calls };
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

	test("posts the Email Sending REST API and does not claim success without config", async () => {
		const sent = mockFetch(() => Response.json(delivery(SUPPORT_TO)));
		const result = await handleSupport({
			env: configuredEnv(),
			fetch: sent.fetch,
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
		expect(sent.calls).toHaveLength(1);
		const call = sent.calls[0];
		expect(call?.url).toBe(
			"https://api.cloudflare.com/client/v4/accounts/account-1/email/sending/send",
		);
		expect(call?.authorization).toBe("Bearer token-1");
		expect(call?.body.to).toBe(SUPPORT_TO);
		expect(call?.body.from).toEqual({
			address: SUPPORT_FROM,
			name: "gpio-companion",
		});
		expect(call?.body.reply_to).toBe("owner@example.com");
		expect(call?.body.subject).toBe("gpio-companion bug report");
		const text = String(call?.body.text);
		expect(text).toContain("User: user-1");
		expect(text).toContain("Surface: web");
		expect(text).toContain("11111111-1111-4111-8111-111111111111");
		expect(text).toContain("Orange Pi 3 LTS");
		expect(text).toContain("blink failed");
		expect(text).not.toContain("ghp_");
		expect(JSON.stringify(call?.body)).not.toContain("token-1");
		await expect(
			handleSupport({
				env: env(),
				userId: "user-1",
				userEmail: null,
				body: { surface: "desktop", text: "no token" },
			}),
		).rejects.toThrow("support email is not configured");
		await expect(
			handleSupport({
				env: env({ CLOUDFLARE_ACCOUNT_ID: "account-1" }),
				userId: "user-1",
				userEmail: null,
				body: { surface: "mobile", text: "no token" },
			}),
		).rejects.toThrow("support email is not configured");
		expect(supportAccepted(null)).toBe(false);
		expect(supportAccepted({})).toBe(false);
		const missing = await supportResponse(() =>
			handleSupport({
				env: env(),
				userId: "user-1",
				userEmail: null,
				body: { surface: "web", text: "token missing" },
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

	test("accepts a queued recipient", async () => {
		const sent = mockFetch(() => Response.json(delivery(SUPPORT_TO, true)));
		const result = await handleSupport({
			env: configuredEnv(),
			fetch: sent.fetch,
			userId: "user-queued",
			userEmail: null,
			now: 2_000,
			body: { surface: "desktop", text: "queued" },
		});
		expect(supportAccepted(result)).toBe(true);
		expect(sent.calls[0]?.body.reply_to).toBeUndefined();
	});

	test("rate-limits per user and does not keep a slot when send fails", async () => {
		let calls = 0;
		const sent = mockFetch(() => {
			calls += 1;
			if (calls === 1) {
				return Response.json({
					success: true,
					result: {
						delivered: [],
						permanent_bounces: [SUPPORT_TO],
						queued: [],
					},
				});
			}
			if (calls === 2) {
				return new Response("no", { status: 500 });
			}
			return Response.json(delivery(SUPPORT_TO));
		});
		const shared = configuredEnv();
		await expect(
			handleSupport({
				env: shared,
				fetch: sent.fetch,
				userId: "user-2",
				userEmail: null,
				now: 5_000,
				body: { surface: "mobile", text: "bounce" },
			}),
		).rejects.toThrow("support email is not configured");
		await expect(
			handleSupport({
				env: shared,
				fetch: sent.fetch,
				userId: "user-2",
				userEmail: null,
				now: 6_000,
				body: { surface: "mobile", text: "upstream" },
			}),
		).rejects.toThrow("support email is not configured");
		for (let i = 0; i < SUPPORT_RATE_MAX; i += 1) {
			await handleSupport({
				env: shared,
				fetch: sent.fetch,
				userId: "user-2",
				userEmail: null,
				now: 10_000 + i,
				body: { surface: "mobile", text: `report ${i}` },
			});
		}
		await expect(
			handleSupport({
				env: shared,
				fetch: sent.fetch,
				userId: "user-2",
				userEmail: null,
				now: 20_000,
				body: { surface: "mobile", text: "too many" },
			}),
		).rejects.toThrow("too many bug reports");
		expect(sent.calls).toHaveLength(2 + SUPPORT_RATE_MAX);
	});
});
