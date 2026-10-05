"no action";

import { SUPPORT_FROM } from "gpio-companion";
import { bearerToken, userIdForAiAuth } from "../../../lib/ai-credentials.ts";
import {
	errorStatus,
	jsonFail,
	jsonOk,
	readJsonBody,
} from "../../../lib/mobile-http.ts";

type SupportNamespace = {
	idFromName(name: string): DurableObjectId;
	get(id: DurableObjectId): {
		fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
	};
};

type DeviceEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	CLOUDFLARE_ACCOUNT_ID?: string;
	CLOUDFLARE_EMAIL_API_TOKEN?: string;
	SUPPORT_FROM_EMAIL?: string;
	SUPPORT_AGENT?: SupportNamespace;
};

export async function onRequestPost(ctx: { request: Request; env: DeviceEnv }) {
	try {
		const token = bearerToken(ctx.request);
		if (!token) {
			throw new Error("sign in first");
		}
		const userId = await userIdForAiAuth(ctx.env, token);
		if (!userId) {
			throw new Error("sign in first");
		}
		if (!ctx.env.SUPPORT_AGENT) {
			throw new Error("support agent is not bound");
		}
		const body = await readJsonBody(ctx.request);
		const from = ctx.env.SUPPORT_FROM_EMAIL?.trim() || SUPPORT_FROM;
		const stub = ctx.env.SUPPORT_AGENT.get(
			ctx.env.SUPPORT_AGENT.idFromName(userId),
		);
		const response = await stub.fetch("https://support-agent/dispatch", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				...body,
				userId,
				mail: {
					accountId: ctx.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "",
					token: ctx.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() || "",
					from,
				},
			}),
		});
		const payload = (await response.json().catch(() => null)) as {
			error?: string;
			sent?: boolean;
			reportId?: string;
		} | null;
		if (!response.ok || !payload?.sent) {
			throw new Error(payload?.error || "support agent is not bound");
		}
		return jsonOk({ sent: true, reportId: payload.reportId });
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
