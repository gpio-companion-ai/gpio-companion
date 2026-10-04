import { describe, expect, test } from "bun:test";
import { type KnownNetwork, knownNetworkLabel } from "../api";

function network(
	partial: Partial<KnownNetwork> & Pick<KnownNetwork, "ssid">,
): KnownNetwork {
	return {
		psk: "",
		source: "os",
		current: false,
		...partial,
	};
}

describe("knownNetworkLabel", () => {
	test("marks the computer's current network", () => {
		expect(
			knownNetworkLabel(network({ ssid: "HomeWiFi", current: true })),
		).toBe("HomeWiFi (this computer)");
	});

	test("marks remembered networks", () => {
		expect(knownNetworkLabel(network({ ssid: "Cafe", source: "saved" }))).toBe(
			"Cafe (saved)",
		);
	});

	test("os networks are ssid only", () => {
		expect(knownNetworkLabel(network({ ssid: "Office" }))).toBe("Office");
	});
});
