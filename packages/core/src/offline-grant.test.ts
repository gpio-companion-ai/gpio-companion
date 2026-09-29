import { describe, expect, test } from "bun:test";
import { DeviceAuthError, generateDeviceKeyPair } from "./device-auth.ts";
import { GPIO_PATH } from "./gpio.ts";
import {
	isOfflineGrantScope,
	mintOfflineGrant,
	OFFLINE_GRANT_TTL_MS,
	parseOfflineEnvelope,
	signOfflineEnvelope,
	verifyOfflineEnvelope,
	verifyOfflineGrant,
	WIFI_PATH,
} from "./offline-grant.ts";

describe("offline-grant", () => {
	test("mints a 24h grant that signs wifi and verifies", async () => {
		const master = await generateDeviceKeyPair();
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: master.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
		});
		expect(bundle.exp - bundle.grant.iat).toBe(OFFLINE_GRANT_TTL_MS);
		expect(bundle.grant.uuid).toBe("pair-uuid");
		const body = JSON.stringify({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
		const envelope = await signOfflineEnvelope({
			bundle,
			method: "PUT",
			path: WIFI_PATH,
			body,
		});
		expect(envelope.headers["X-Gpio-Grant"]).toBeTruthy();
		const parsed = parseOfflineEnvelope(envelope);
		await verifyOfflineEnvelope({
			masterPublicKeyPem: master.publicKeyPem,
			uuid: "pair-uuid",
			method: parsed.method,
			path: parsed.path,
			body: parsed.body,
			headers: parsed.headers,
		});
	});

	test("rejects a grant for another board uuid", async () => {
		const master = await generateDeviceKeyPair();
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: master.privateKeyPem,
			uuid: "board-a",
			userId: "user-1",
		});
		try {
			await verifyOfflineGrant({
				masterPublicKeyPem: master.publicKeyPem,
				grant: bundle.grant,
				uuid: "board-b",
				method: "PUT",
				path: WIFI_PATH,
			});
			throw new Error("expected failure");
		} catch (error) {
			expect(error).toBeInstanceOf(DeviceAuthError);
			expect((error as DeviceAuthError).message).toBe(
				"offline grant device mismatch",
			);
		}
	});

	test("rejects pairing and other out-of-scope paths", async () => {
		expect(isOfflineGrantScope("POST", "/v1/pairing/claim")).toBe(false);
		expect(isOfflineGrantScope("GET", "/v1/pairing/credentials")).toBe(false);
		expect(isOfflineGrantScope("POST", "/v1/opencode/session")).toBe(false);
		expect(isOfflineGrantScope("POST", "/v1/update")).toBe(false);
		expect(isOfflineGrantScope("POST", "/v1/projects/sync")).toBe(false);
		expect(isOfflineGrantScope("POST", "/v1/projects/remove")).toBe(false);
		expect(isOfflineGrantScope("POST", "/v1/projects/push")).toBe(false);
		expect(isOfflineGrantScope("PUT", GPIO_PATH)).toBe(true);
		const master = await generateDeviceKeyPair();
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: master.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
		});
		try {
			await verifyOfflineGrant({
				masterPublicKeyPem: master.publicKeyPem,
				grant: bundle.grant,
				uuid: "pair-uuid",
				method: "POST",
				path: "/v1/pairing/unpair",
			});
			throw new Error("expected failure");
		} catch (error) {
			expect((error as DeviceAuthError).message).toBe(
				"offline grant scope mismatch",
			);
		}
	});

	test("rejects an expired grant", async () => {
		const master = await generateDeviceKeyPair();
		const now = 1_700_000_000_000;
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: master.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
			now,
		});
		try {
			await verifyOfflineGrant({
				masterPublicKeyPem: master.publicKeyPem,
				grant: bundle.grant,
				uuid: "pair-uuid",
				method: "GET",
				path: GPIO_PATH,
				now: now + OFFLINE_GRANT_TTL_MS + 1,
			});
			throw new Error("expected failure");
		} catch (error) {
			expect((error as DeviceAuthError).message).toBe("expired offline grant");
		}
	});

	test("rejects a grant signed by another master key", async () => {
		const master = await generateDeviceKeyPair();
		const other = await generateDeviceKeyPair();
		const bundle = await mintOfflineGrant({
			masterPrivateKeyPem: master.privateKeyPem,
			uuid: "pair-uuid",
			userId: "user-1",
		});
		try {
			await verifyOfflineGrant({
				masterPublicKeyPem: other.publicKeyPem,
				grant: bundle.grant,
				uuid: "pair-uuid",
				method: "PUT",
				path: WIFI_PATH,
			});
			throw new Error("expected failure");
		} catch (error) {
			expect((error as DeviceAuthError).message).toBe("invalid offline grant");
		}
	});
});
