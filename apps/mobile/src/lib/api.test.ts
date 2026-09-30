import { afterEach, describe, expect, mock, test } from "bun:test";

// api.ts -> config.ts imports expo-constants; replace it before the module loads
mock.module("expo-constants", () => ({
	default: { expoConfig: { extra: {} } },
}));

const { getSession, setSessionLostHandler, setTokenProvider } = await import(
	"./api.ts"
);

const originalFetch = globalThis.fetch;

function mockFetch(
	handler: (init?: RequestInit) => Response | Promise<Response>,
): typeof fetch {
	return ((input: RequestInfo | URL, init?: RequestInit) =>
		handler(init)) as unknown as typeof fetch;
}

function jsonResponse(body: unknown, status = 200): Response {
	return new Response(JSON.stringify(body), {
		status,
		headers: { "content-type": "application/json" },
	});
}

afterEach(() => {
	globalThis.fetch = originalFetch;
	setTokenProvider(null);
	setSessionLostHandler(null);
});

describe("api", () => {
	test("returns data on ok responses", async () => {
		globalThis.fetch = mockFetch(async () =>
			jsonResponse({ ok: true, data: { id: "u1" } }),
		);
		expect((await getSession("token-1")).id).toBe("u1");
	});

	test("throws the server error message", async () => {
		globalThis.fetch = mockFetch(async () =>
			jsonResponse({ ok: false, error: "no such device" }, 400),
		);
		await expect(getSession("token-1")).rejects.toThrow("no such device");
	});

	test("falls back to a status message when error is empty", async () => {
		globalThis.fetch = mockFetch(async () => jsonResponse({ ok: false }, 500));
		await expect(getSession("token-1")).rejects.toThrow("HTTP 500");
	});

	test("non-json error pages become readable errors", async () => {
		globalThis.fetch = mockFetch(
			() =>
				new Response("<html>bad gateway</html>", {
					status: 502,
					headers: { "content-type": "text/html" },
				}),
		);
		await expect(getSession("token-1")).rejects.toThrow("HTTP 502");
	});

	test("refreshes the token once on 401", async () => {
		const authorizations: string[] = [];
		globalThis.fetch = mockFetch(async (init) => {
			const headers = (init?.headers ?? {}) as Record<string, string>;
			authorizations.push(headers.authorization);
			if (authorizations.length === 1) {
				return jsonResponse({ ok: false, error: "sign in first" }, 401);
			}
			return jsonResponse({ ok: true, data: { id: "u2" } });
		});
		setTokenProvider(async () => "token-2");
		expect((await getSession("token-1")).id).toBe("u2");
		expect(authorizations).toEqual(["Bearer token-1", "Bearer token-2"]);
	});

	test("does not retry more than once after a refresh", async () => {
		let calls = 0;
		globalThis.fetch = mockFetch(async () => {
			calls += 1;
			return jsonResponse({ ok: false, error: "sign in first" }, 401);
		});
		setTokenProvider(async () => "token-2");
		await expect(getSession("token-1")).rejects.toThrow("sign in first");
		expect(calls).toBe(2);
	});

	test("surfaces unauthorized when no provider can refresh", async () => {
		let lost = 0;
		globalThis.fetch = mockFetch(async () =>
			jsonResponse({ ok: false, error: "sign in first" }, 401),
		);
		setTokenProvider(async () => null);
		setSessionLostHandler(() => {
			lost += 1;
		});
		await expect(getSession("token-1")).rejects.toThrow("sign in first");
		expect(lost).toBe(1);
	});

	test("signs out when a new token is still unauthorized", async () => {
		let lost = 0;
		globalThis.fetch = mockFetch(async () =>
			jsonResponse({ ok: false, error: "sign in first" }, 401),
		);
		setTokenProvider(async () => "token-2");
		setSessionLostHandler(() => {
			lost += 1;
		});
		await expect(getSession("token-1")).rejects.toThrow("sign in first");
		expect(lost).toBe(1);
	});

	test("keeps the session when refresh returns the same token", async () => {
		let calls = 0;
		let lost = 0;
		globalThis.fetch = mockFetch(async () => {
			calls += 1;
			return jsonResponse({ ok: false, error: "sign in first" }, 401);
		});
		setTokenProvider(async () => "token-1");
		setSessionLostHandler(() => {
			lost += 1;
		});
		await expect(getSession("token-1")).rejects.toThrow("sign in first");
		expect(calls).toBe(1);
		expect(lost).toBe(0);
	});
});
