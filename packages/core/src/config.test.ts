import { describe, expect, test } from "bun:test";
import {
	deviceOpencodePermissionMode,
	emptyDeviceConfig,
	parseDeviceConfig,
	parseTunnelConfig,
	parseUserProfile,
	profileFrom,
	redactDeviceConfig,
} from "./config.ts";

describe("device config", () => {
	test("empty raspberrypi config", () => {
		expect(emptyDeviceConfig("raspberrypi")).toEqual({
			hardware: "raspberrypi",
			tunnel: { token: "", hostname: "", apiHostname: "", tunnelId: "" },
		});
	});

	test("parses tunnel endpoint", () => {
		expect(
			parseTunnelConfig({
				token: " tok ",
				hostname: " t3.example.com ",
			}),
		).toEqual({
			token: "tok",
			hostname: "t3.example.com",
			apiHostname: "",
			tunnelId: "",
		});
	});

	test("parses full device config", () => {
		const config = parseDeviceConfig({
			hardware: "orangepi",
			tunnel: { token: "abc", hostname: "pi.example.com" },
		});
		expect(config.hardware).toBe("orangepi");
		expect(redactDeviceConfig(config).tunnel.token).toBe("***");
	});

	test("parses opencode permission mode with ask default", () => {
		expect(
			parseDeviceConfig({
				hardware: "raspberrypi",
				tunnel: { token: "", hostname: "" },
				opencodePermission: "full",
			}).opencodePermission,
		).toBe("full");
		expect(
			parseDeviceConfig({
				hardware: "raspberrypi",
				tunnel: { token: "", hostname: "" },
				opencodePermission: "once",
			}).opencodePermission,
		).toBeUndefined();
		expect(
			deviceOpencodePermissionMode(
				parseDeviceConfig({
					hardware: "raspberrypi",
					tunnel: { token: "", hostname: "" },
				}),
			),
		).toBe("ask");
		expect(deviceOpencodePermissionMode(undefined)).toBe("ask");
	});

	test("rejects unknown hardware", () => {
		expect(() =>
			parseDeviceConfig({
				hardware: "esp32",
				tunnel: { token: "", hostname: "" },
			}),
		).toThrow("hardware");
	});

	test("parses user profile", () => {
		expect(parseUserProfile({ level: "beginner", context: "home" })).toEqual({
			level: "beginner",
			context: "home",
		});
		expect(profileFrom({ level: "expert", context: "lab" })).toEqual({
			level: "expert",
			context: "lab",
		});
	});

	test("rejects invalid user profile values", () => {
		expect(() => parseUserProfile({ level: "guru", context: "home" })).toThrow(
			"profile.level",
		);
		expect(() =>
			parseUserProfile({ level: "expert", context: "space" }),
		).toThrow("profile.context");
		expect(() => parseUserProfile("beginner")).toThrow("profile");
		expect(profileFrom({ level: "nope" })).toBeNull();
		expect(profileFrom(undefined)).toBeNull();
	});

	test("keeps profile through device config parsing", () => {
		const config = parseDeviceConfig({
			hardware: "raspberrypi",
			tunnel: { token: "", hostname: "" },
			profile: { level: "intermediate", context: "education" },
		});
		expect(config.profile).toEqual({
			level: "intermediate",
			context: "education",
		});
		expect(
			parseDeviceConfig({
				hardware: "raspberrypi",
				tunnel: { token: "", hostname: "" },
				profile: { level: "nope", context: "home" },
			}).profile,
		).toBeUndefined();
		expect(redactDeviceConfig(config).profile).toEqual(config.profile);
	});
});
