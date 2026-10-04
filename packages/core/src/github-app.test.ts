import { describe, expect, test } from "bun:test";
import {
	createGithubAppJwt,
	gitHttpsUsername,
	isGithubAppToken,
	timingSafeEqualString,
} from "./github-app.ts";

describe("github app tokens", () => {
	test("git https username is x-access-token for installation tokens", () => {
		expect(isGithubAppToken("ghs_abc")).toBe(true);
		expect(gitHttpsUsername("ghs_abc", "ada")).toBe("x-access-token");
		expect(gitHttpsUsername("ghp_abc", "ada")).toBe("ada");
	});

	test("timing-safe compare rejects empty and mismatched keys", () => {
		expect(timingSafeEqualString("pair-key", "pair-key")).toBe(true);
		expect(timingSafeEqualString("pair-key", "pair-kez")).toBe(false);
		expect(timingSafeEqualString("", "")).toBe(false);
		expect(timingSafeEqualString("ab", "abc")).toBe(false);
	});

	test("signs a github app jwt", async () => {
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
		const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
		const body = btoa(String.fromCharCode(...new Uint8Array(pkcs8)));
		const pem = `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----`;
		const jwt = await createGithubAppJwt("12345", pem, 1_700_000_000_000);
		const [header, payload, signature] = jwt.split(".");
		expect(header).toBeTruthy();
		expect(payload).toBeTruthy();
		expect(signature).toBeTruthy();
		const claims = JSON.parse(
			Buffer.from(payload ?? "", "base64url").toString("utf8"),
		) as { iss: string };
		expect(claims.iss).toBe("12345");
	});
});
