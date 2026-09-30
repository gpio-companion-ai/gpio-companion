import { describe, expect, test } from "bun:test";
import { generateDeviceKeyPair } from "./device-auth.ts";
import {
	asFlashStatus,
	asRunStatus,
	encodeHubMessage,
	HUB_PATH,
	HUB_TOKEN_PREFIX,
	hubWsUrl,
	parseHubMessage,
	signHubTicket,
	verifyHubTicket,
} from "./hub.ts";

describe("hub protocol", () => {
	test("round-trips messages and rejects junk", () => {
		const flash = encodeHubMessage({
			v: 1,
			type: "flash",
			payload: { running: false, last: null },
		});
		expect(parseHubMessage(flash)).toEqual({
			v: 1,
			type: "flash",
			payload: { running: false, last: null },
		});
		expect(parseHubMessage({ v: 1, type: "ping" })).toEqual({
			v: 1,
			type: "ping",
		});
		expect(parseHubMessage("{")).toBeNull();
		expect(parseHubMessage({ v: 2, type: "flash" })).toBeNull();
		expect(parseHubMessage({ v: 1, type: "gpio" })).toBeNull();
		expect(parseHubMessage({ v: 1, type: "t3" })).toBeNull();
		expect(parseHubMessage({ v: 1, type: "secret" })).toBeNull();
		expect(
			parseHubMessage({
				v: 1,
				type: "arduinoProxy",
				payload: { connected: true },
			})?.type,
		).toBe("arduinoProxy");
	});

	test("narrows channel payloads", () => {
		expect(asFlashStatus({ running: true, last: null })?.running).toBe(true);
		expect(asFlashStatus({ running: "yes" })).toBeNull();
		expect(asRunStatus({ running: true, log: "", last: null })?.running).toBe(
			true,
		);
		expect(asRunStatus({ running: true, last: null })).toBeNull();
	});

	test("builds a same-origin hub websocket url", () => {
		expect(hubWsUrl("https://gpio-companion.com/", "abc-def", "tok")).toBe(
			`wss://gpio-companion.com${HUB_PATH}?uuid=abc-def&ticket=tok`,
		);
	});

	test("mints and verifies a pi ticket", async () => {
		const keys = await generateDeviceKeyPair();
		const ticket = await signHubTicket({
			privateKeyPem: keys.privateKeyPem,
			uuid: "pair-uuid",
			origin: "https://gpio-companion.com",
		});
		expect(ticket.token.startsWith(HUB_TOKEN_PREFIX)).toBe(true);
		expect(ticket.wsUrl).toContain("ticket=");
		const claims = await verifyHubTicket({
			token: ticket.token,
			privateKeyPem: keys.privateKeyPem,
		});
		expect(claims).toMatchObject({ uuid: "pair-uuid", role: "pi" });
	});

	test("rejects expired and forged tickets", async () => {
		const keys = await generateDeviceKeyPair();
		const other = await generateDeviceKeyPair();
		const ticket = await signHubTicket({
			privateKeyPem: keys.privateKeyPem,
			uuid: "pair-uuid",
			now: 1_000,
			ttlMs: 10,
		});
		await expect(
			verifyHubTicket({
				token: ticket.token,
				privateKeyPem: keys.privateKeyPem,
				now: 2_000,
			}),
		).rejects.toThrow("expired hub token");
		await expect(
			verifyHubTicket({
				token: ticket.token,
				privateKeyPem: other.privateKeyPem,
			}),
		).rejects.toThrow("invalid hub token");
	});
});
