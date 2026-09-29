"no action";

import { handleAddressRead, handleAddressSave } from "../../lib/address.ts";
import { jlcpcbResponse } from "../../lib/jlcpcb.ts";
import { readJsonBody } from "../../lib/mobile-http.ts";
import { requireIdentity } from "../../lib/session.ts";

type AddressContext = {
	request: Request;
	env: {
		DYNAMIC_PAGE_KV: KVNamespace;
	};
};

async function userId(ctx: AddressContext): Promise<string> {
	const identity = await requireIdentity(ctx);
	if (!identity.id) {
		throw new Error("sign in first");
	}
	return identity.id;
}

export async function onRequestGet(ctx: AddressContext) {
	return jlcpcbResponse(async () => {
		return handleAddressRead({
			kv: ctx.env.DYNAMIC_PAGE_KV,
			userId: await userId(ctx),
		});
	});
}

export async function onRequestPut(ctx: AddressContext) {
	return jlcpcbResponse(async () => {
		return handleAddressSave({
			kv: ctx.env.DYNAMIC_PAGE_KV,
			userId: await userId(ctx),
			body: await readJsonBody(ctx.request),
		});
	});
}
