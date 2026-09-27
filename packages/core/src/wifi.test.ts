import { describe, expect, test } from "bun:test";
import {
	classifyWifiConnectError,
	parseWifiBleStatus,
	parseWifiConfig,
	publicWifiFailure,
	WifiConnectError,
	wifiConnectMessage,
	wifiDevicesToClaim,
} from "./wifi.ts";

describe("wifi", () => {
	test("parses ssid psk and pairing uuid", () => {
		expect(
			parseWifiConfig({
				ssid: " bench ",
				psk: " secret-pass ",
				uuid: " pair-uuid ",
			}),
		).toEqual({
			ssid: "bench",
			psk: "secret-pass",
			uuid: "pair-uuid",
		});
	});

	test("requires ssid", () => {
		expect(() => parseWifiConfig({ psk: "x", uuid: "u" })).toThrow("ssid");
	});
});

describe("classifyWifiConnectError", () => {
	test("ssid not found", () => {
		expect(
			classifyWifiConnectError("Error: No network with SSID 'lab' found."),
		).toBe("ssid-not-found");
		expect(
			classifyWifiConnectError("The Wi-Fi network could not be found"),
		).toBe("ssid-not-found");
		expect(classifyWifiConnectError("SSID bench not found")).toBe(
			"ssid-not-found",
		);
	});

	test("password", () => {
		expect(
			classifyWifiConnectError(
				"Error: Connection activation failed: (7) Secrets were required, but not provided.",
			),
		).toBe("password");
		expect(
			classifyWifiConnectError(
				"802-11-wireless-security.psk: property is invalid",
			),
		).toBe("password");
		expect(classifyWifiConnectError("wrong password")).toBe("password");
		expect(classifyWifiConnectError("bad password")).toBe("password");
	});

	test("no device", () => {
		expect(
			classifyWifiConnectError(
				"Error: No suitable device found for this connection.",
			),
		).toBe("no-device");
		expect(classifyWifiConnectError("Error: Device 'wlan0' not found.")).toBe(
			"no-device",
		);
		expect(classifyWifiConnectError("wifi is disabled")).toBe("no-device");
		expect(
			classifyWifiConnectError("Scanning not allowed while unavailable."),
		).toBe("no-device");
		expect(
			classifyWifiConnectError(
				"Error: Device 'wlan0' is not available because it is unmanaged.",
			),
		).toBe("no-device");
	});

	test("failed fallback", () => {
		expect(classifyWifiConnectError("Error: Timeout")).toBe("failed");
		expect(classifyWifiConnectError("")).toBe("failed");
	});
});

describe("wifiDevicesToClaim", () => {
	test("claims unmanaged and unavailable wifi only", () => {
		expect(
			wifiDevicesToClaim(
				"eth0:ethernet:connected\nwlan0:wifi:unmanaged\np2p-dev-wlan0:wifi-p2p:unmanaged\nwlan1:wifi:unavailable\nwlan2:wifi:disconnected\n",
			),
		).toEqual(["wlan0", "wlan1"]);
	});
});

describe("WifiConnectError", () => {
	test("maps reason to a public message", () => {
		expect(wifiConnectMessage("ssid-not-found")).toBe("wifi network not found");
		expect(new WifiConnectError("password").message).toBe(
			"wifi password incorrect",
		);
		expect(publicWifiFailure("lab", "ssid-not-found")).toEqual({
			ssid: "lab",
			connected: false,
			reason: "ssid-not-found",
			error: "wifi network not found",
		});
	});
});

describe("parseWifiBleStatus", () => {
	test("success is text, not the raw body", () => {
		expect(parseWifiBleStatus('{"ssid":"lab","connected":true}')).toEqual({
			ok: true,
			ssid: "lab",
			message: "",
		});
	});

	test("failure uses the public reason string", () => {
		expect(
			parseWifiBleStatus(
				'{"ssid":"lab","connected":false,"reason":"password","error":"wifi password incorrect"}',
			),
		).toEqual({
			ok: false,
			ssid: "lab",
			message: "wifi password incorrect",
		});
		expect(
			parseWifiBleStatus('{"connected":false,"reason":"ssid-not-found"}'),
		).toEqual({
			ok: false,
			message: "wifi network not found",
		});
	});

	test("non-json is a generic failure", () => {
		expect(parseWifiBleStatus("not json")).toEqual({
			ok: false,
			message: "wifi connect failed",
		});
	});
});
