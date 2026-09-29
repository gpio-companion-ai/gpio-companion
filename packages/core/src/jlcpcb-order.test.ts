import { describe, expect, test } from "bun:test";
import { Glob } from "bun";
import { orderConfirmBody, orderQuoteBody } from "./jlcpcb-order.ts";
import type { ShippingAddress } from "./shipping-address.ts";

const address: ShippingAddress = {
	name: "Ada Lovelace",
	line1: "1 Analytical",
	line2: null,
	city: "London",
	region: null,
	postalCode: "SW1",
	country: "GB",
};

describe("jlcpcb order gate", () => {
	test("confirm is impossible without credentials, address, kind, and confirm", () => {
		const draft = { kind: "pcb", fileKey: " gerber-1 " };
		expect(orderConfirmBody(false, address, draft, true)).toBeNull();
		expect(orderConfirmBody(true, null, draft, true)).toBeNull();
		expect(
			orderConfirmBody(true, address, { kind: "assembly" }, true),
		).toBeNull();
		expect(orderConfirmBody(true, address, draft, false)).toBeNull();
		expect(orderConfirmBody(true, address, null, true)).toBeNull();
	});

	test("confirm body never carries an address", () => {
		expect(
			orderConfirmBody(
				true,
				address,
				{ kind: "pcb", fileKey: " gerber-1 ", layer: " 2 " },
				true,
			),
		).toEqual({
			confirm: true,
			kind: "pcb",
			fileKey: "gerber-1",
			layer: "2",
		});
		expect(
			orderConfirmBody(true, address, { kind: "tdp", itemCount: " 1 " }, true),
		).toEqual({
			confirm: true,
			kind: "tdp",
			itemCount: "1",
		});
	});

	test("quote does not set confirm", () => {
		expect(orderQuoteBody(false, { kind: "pcb" })).toBeNull();
		expect(
			orderQuoteBody(true, { kind: "tdp", fileAccessId: " file-1 " }),
		).toEqual({
			kind: "tdp",
			fileAccessId: "file-1",
		});
	});

	test("order panels do not call JLCPCB or import the client", async () => {
		const root = `${import.meta.dir}/../../..`;
		const glob = new Glob("**/*.{ts,tsx}");
		const hits: string[] = [];
		for await (const path of glob.scan({
			cwd: `${root}/apps`,
			onlyFiles: true,
		})) {
			if (
				!path.includes("OrderReview") &&
				!path.includes("JlcpcbCard") &&
				!path.includes("AddressForm")
			) {
				continue;
			}
			const text = await Bun.file(`${root}/apps/${path}`).text();
			if (
				text.includes("@community-jlcpcb/client") ||
				text.includes("open.jlcpcb.com") ||
				text.includes("api.jlcpcb.com")
			) {
				hits.push(path);
			}
		}
		expect(hits).toEqual([]);
	});
});
