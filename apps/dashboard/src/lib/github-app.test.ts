import { describe, expect, test } from "bun:test";
import {
	githubAppCallbackCandidates,
	githubAppCallbackUri,
	githubAppCanCreate,
	githubAppOAuthUrl,
	issueGithubCredentials,
	parseGithubAppInstall,
} from "./github-app.ts";
import type { StoredPairing } from "./pairing-store.ts";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
	async delete(key: string) {
		this.store.delete(key);
	}
}

const pairing: StoredPairing = {
	userId: "user-1",
	uuid: "pair-uuid",
	key: "pair-key",
	deviceUrl: "https://api.example",
	login: "ada",
	email: "ada@example.com",
	claimedAt: "2026-08-31T00:00:00.000Z",
	label: "",
	bleMac: "",
};

describe("github app kv", () => {
	test("parses install records", () => {
		expect(parseGithubAppInstall(null)).toBeNull();
		expect(
			parseGithubAppInstall(
				JSON.stringify({ installationId: 9, login: "ada" }),
			),
		).toEqual({ installationId: 9, login: "ada" });
		expect(
			parseGithubAppInstall(
				JSON.stringify({
					installationId: 9,
					login: "ada",
					userToken: "ghu_x",
					refreshToken: "ghr_x",
				}),
			),
		).toEqual({
			installationId: 9,
			login: "ada",
			userToken: "ghu_x",
			refreshToken: "ghr_x",
		});
		expect(githubAppCanCreate({ installationId: 9, login: "ada" })).toBe(false);
		expect(
			githubAppCanCreate({
				installationId: 9,
				login: "ada",
				refreshToken: "ghr_x",
			}),
		).toBe(true);
		expect(
			githubAppOAuthUrl(
				"Iv1.abc",
				"https://gpio-companion.com/profile/github",
				"st",
			),
		).toContain("client_id=Iv1.abc");
	});

	test("oauth callback is profile github, with keys fallback", () => {
		const request = new Request("https://gpio-companion.com/api/github-app");
		const env = {
			DYNAMIC_PAGE_KV: {} as KVNamespace,
			PUBLIC_AUTH_REDIRECT_URI: "https://gpio-companion.com/callback",
		};
		expect(githubAppCallbackUri(request, env)).toBe(
			"https://gpio-companion.com/profile/github",
		);
		expect(
			githubAppCallbackCandidates(
				request,
				env,
				"https://gpio-companion.com/profile/github",
			),
		).toEqual([
			"https://gpio-companion.com/profile/github",
			"https://gpio-companion.com/devices/keys",
		]);
	});

	test("issues credentials for a matching pairing key", async () => {
		const kv = new MemoryKv();
		await kv.put("pair:pair-uuid", "user-1");
		await kv.put("device:user-1", JSON.stringify([pairing]));
		await kv.put(
			"github-app:user-1",
			JSON.stringify({ installationId: 42, login: "ada" }),
		);
		const pair = (await crypto.subtle.generateKey(
			{
				name: "RSASSA-PKCS1-v1_5",
				modulusLength: 2048,
				publicExponent: Uint8Array.of(1, 0, 1),
				hash: "SHA-256",
			},
			true,
			["sign", "verify"],
		)) as CryptoKeyPair;
		const pkcs8 = new Uint8Array(
			await crypto.subtle.exportKey("pkcs8", pair.privateKey),
		);
		let body = "";
		for (const byte of pkcs8) {
			body += String.fromCharCode(byte);
		}
		const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(body)}\n-----END PRIVATE KEY-----`;
		const previous = globalThis.fetch;
		globalThis.fetch = (async () =>
			new Response(
				JSON.stringify({
					token: "ghs_live",
					expires_at: "2026-08-31T01:00:00.000Z",
				}),
				{ status: 201 },
			)) as unknown as typeof fetch;
		try {
			const creds = await issueGithubCredentials(
				{
					DYNAMIC_PAGE_KV: kv as unknown as KVNamespace,
					GITHUB_APP_ID: "1",
					GITHUB_APP_PRIVATE_KEY: pem,
				},
				"pair-uuid",
				"pair-key",
			);
			expect(creds.token).toBe("ghs_live");
			expect(creds.username).toBe("x-access-token");
			expect(creds.login).toBe("ada");
		} finally {
			globalThis.fetch = previous;
		}
	});

	test("rejects a bad pairing key", async () => {
		const kv = new MemoryKv();
		await kv.put("pair:pair-uuid", "user-1");
		await kv.put("device:user-1", JSON.stringify([pairing]));
		await expect(
			issueGithubCredentials(
				{
					DYNAMIC_PAGE_KV: kv as unknown as KVNamespace,
					GITHUB_APP_ID: "1",
					GITHUB_APP_PRIVATE_KEY: "unused",
				},
				"pair-uuid",
				"wrong",
			),
		).rejects.toThrow("pairing key mismatch");
	});
});
