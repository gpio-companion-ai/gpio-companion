"no action";

import {
	addressContext,
	handleAddressRead,
	handleAddressSave,
} from "../../lib/address.ts";
import { jlcpcbResponse } from "../../lib/jlcpcb.ts";
import { readJsonBody } from "../../lib/mobile-http.ts";

type AddressContext = {
	request: Request;
	env: {
		DYNAMIC_PAGE_KV?: KVNamespace;
	};
};

export async function onRequestGet(ctx: AddressContext) {
	return jlcpcbResponse(async () => {
		return handleAddressRead(await addressContext(ctx));
	});
}

export async function onRequestPut(ctx: AddressContext) {
	return jlcpcbResponse(async () => {
		return handleAddressSave({
			...(await addressContext(ctx)),
			body: await readJsonBody(ctx.request),
		});
	});
}
