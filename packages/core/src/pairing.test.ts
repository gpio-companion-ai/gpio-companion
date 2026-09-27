import { describe, expect, test } from "bun:test";
import {
	emptyPairingState,
	loginFromEmail,
	pairClaimNotice,
	pairingCredentials,
	parsePairingClaim,
	publicPairing,
} from "./pairing.ts";

describe("pairing", () => {
	test("maps email to login", () => {
		expect(loginFromEmail("ada@gpio-companion.com")).toBe("ada");
	});

	test("parses a claim", () => {
		const claim = parsePairingClaim({
			uuid: " u1 ",
			key: " k1 ",
			userId: "user-1",
			email: "ada@gpio-companion.com",
		});
		expect(claim.login).toBe("ada");
		expect(
			publicPairing({ ...claim, claimed: true, claimedAt: "now", key: "k1" })
				.paired,
		).toBe(true);
	});

	test("credentials include device url", () => {
		const creds = pairingCredentials(
			{ ...emptyPairingState("u1", "k1"), claimed: true, userId: "user-1" },
			"https://api-u1.gpio-companion.com",
		);
		expect(creds.uuid).toBe("u1");
		expect(creds.key).toBe("k1");
		expect(creds.deviceUrl).toBe("https://api-u1.gpio-companion.com");
		expect(creds.userId).toBe("user-1");
	});

	test("claim notice distinguishes self and other owner", () => {
		expect(pairClaimNotice({ alreadyYours: true, uuid: "u1" })).toBe("yours");
		expect(
			pairClaimNotice({ pending: true, alreadyPaired: "other", uuid: "u1" }),
		).toBe("other-pending");
		expect(pairClaimNotice({ alreadyPaired: "other", pending: false })).toBe(
			"other",
		);
		expect(pairClaimNotice({ ok: true, pending: false })).toBeNull();
	});
});
