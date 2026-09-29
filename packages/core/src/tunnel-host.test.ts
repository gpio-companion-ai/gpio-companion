import { describe, expect, test } from "bun:test";
import {
	cloudflareTunnelName,
	pairingSlug,
	pairingUuidFromDeviceUrl,
	publicDeviceUrl,
	tunnelHostnames,
} from "./tunnel-host.ts";

describe("tunnel hostnames", () => {
	test("publishes only the device API hostname", () => {
		const uuid = "550e8400-e29b-41d4-a716-446655440000";
		expect(pairingSlug(uuid)).toBe("550e8400e29b41d4a716446655440000");
		expect(tunnelHostnames(uuid)).toEqual({
			slug: "550e8400e29b41d4a716446655440000",
			apiHostname: "api-550e8400e29b41d4a716446655440000.gpio-companion.com",
		});
		expect(JSON.stringify(tunnelHostnames(uuid))).not.toContain("t3-");
		expect(cloudflareTunnelName(uuid)).toBe(`gpio-${uuid}`);
		expect(
			pairingUuidFromDeviceUrl(
				"https://api-550e8400e29b41d4a716446655440000.gpio-companion.com/",
			),
		).toBe(uuid);
	});

	test("builds https device url", () => {
		expect(publicDeviceUrl("api-x.gpio-companion.com")).toBe(
			"https://api-x.gpio-companion.com",
		);
	});
});
