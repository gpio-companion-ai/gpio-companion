import { describe, expect, it } from "bun:test";
import { asString, errorStatus, jsonFail, jsonOk } from "./mobile-http.ts";

describe("mobile-http", () => {
	it("wraps ok payloads", async () => {
		const response = jsonOk({ id: "u1" });
		expect(response.status).toBe(200);
		expect<unknown>(await response.json()).toEqual({
			ok: true,
			data: { id: "u1" },
		});
	});

	it("maps sign-in errors to 401", () => {
		expect(errorStatus(new Error("sign in first"))).toBe(401);
		expect(
			errorStatus(
				new Error(
					"profile unavailable; tokenBytes=120; session=br-connection-profile-unavailable",
				),
			),
		).toBe(401);
		expect(errorStatus(new Error("admin only"))).toBe(403);
		expect(errorStatus(new Error("uuid is required"))).toBe(400);
		expect(errorStatus(new Error("device 502"))).toBe(502);
		expect(
			errorStatus(
				new Error(
					"board did not respond in time. If it is online, wait a few seconds and mint again.",
				),
			),
		).toBe(502);
	});

	it("returns fail envelopes", async () => {
		const response = jsonFail("sign in first", 401);
		expect(response.status).toBe(401);
		expect<unknown>(await response.json()).toEqual({
			ok: false,
			error: "sign in first",
		});
	});

	it("coerces strings", () => {
		expect(asString("abc")).toBe("abc");
		expect(asString(1)).toBe("");
		expect(asString(undefined)).toBe("");
	});
});
