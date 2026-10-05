import {
	SUPPORT_FROM,
	type SupportChatState,
	type SupportChatTurn,
	supportLocale,
	supportSurface,
	supportText,
} from "gpio-companion";
import { errorStatus, jsonFail, jsonOk } from "./mobile-http.ts";
import {
	refundSupportSlot,
	SUPPORT_RATE_WINDOW_MS,
	type SupportEnv,
	takeSupportSlot,
} from "./support.ts";

type SupportNamespace = {
	idFromName(name: string): DurableObjectId;
	get(id: DurableObjectId): {
		fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
	};
};

export type SupportChatEnv = SupportEnv & {
	SUPPORT_AGENT?: SupportNamespace;
};

function fromAddress(env: SupportChatEnv): string {
	const raw = env.SUPPORT_FROM_EMAIL?.trim() || SUPPORT_FROM;
	if (!/^[^@\s]+@gpio-companion\.com$/i.test(raw)) {
		return SUPPORT_FROM;
	}
	return raw;
}

function replyTo(email: string | null): string | undefined {
	const raw = email?.trim() ?? "";
	if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
		return undefined;
	}
	return raw;
}

function openSlotKey(userId: string): string {
	return `support-open:${userId}`;
}

async function rememberOpenSlot(
	env: SupportChatEnv,
	userId: string,
	stamp: number,
): Promise<void> {
	await env.DYNAMIC_PAGE_KV.put(openSlotKey(userId), String(stamp), {
		expirationTtl: Math.ceil(SUPPORT_RATE_WINDOW_MS / 1000),
	});
}

async function clearOpenSlot(
	env: SupportChatEnv,
	userId: string,
): Promise<void> {
	await env.DYNAMIC_PAGE_KV.delete(openSlotKey(userId));
}

async function refundOpenSlot(
	env: SupportChatEnv,
	userId: string,
): Promise<void> {
	const raw = await env.DYNAMIC_PAGE_KV.get(openSlotKey(userId));
	if (!raw) {
		return;
	}
	await clearOpenSlot(env, userId);
	const stamp = Number(raw);
	if (Number.isFinite(stamp)) {
		await refundSupportSlot(env, userId, stamp);
	}
}

function stubFor(env: SupportChatEnv, userId: string) {
	if (!env.SUPPORT_AGENT) {
		throw new Error("support agent is not bound");
	}
	return env.SUPPORT_AGENT.get(env.SUPPORT_AGENT.idFromName(userId));
}

async function agentFetch(
	env: SupportChatEnv,
	userId: string,
	path: string,
	init?: RequestInit,
): Promise<SupportChatState & { refund?: boolean }> {
	let response: Response;
	try {
		response = await stubFor(env, userId).fetch(
			`https://support-agent${path}`,
			init,
		);
	} catch {
		throw new Error("support agent is not bound");
	}
	const payload = (await response.json().catch(() => null)) as
		| (SupportChatState & { error?: string; refund?: boolean })
		| null;
	if (!response.ok) {
		throw new Error(payload?.error || "support agent is not bound");
	}
	if (!payload?.status || !Array.isArray(payload.messages)) {
		throw new Error("support agent is not bound");
	}
	return payload;
}

export async function readSupportChat(input: {
	env: SupportChatEnv;
	userId: string;
}): Promise<SupportChatState> {
	return agentFetch(input.env, input.userId, "/state");
}

export async function cancelSupportChat(input: {
	env: SupportChatEnv;
	userId: string;
}): Promise<SupportChatState> {
	const next = await agentFetch(input.env, input.userId, "/cancel", {
		method: "POST",
	});
	if (next.refund !== false) {
		await refundOpenSlot(input.env, input.userId);
	}
	return next;
}

export async function postSupportChat(input: {
	env: SupportChatEnv;
	userId: string;
	userEmail: string | null;
	body: Record<string, unknown>;
}): Promise<SupportChatState> {
	if (input.body.cancel === true) {
		return cancelSupportChat(input);
	}
	const surface = supportSurface(input.body.surface);
	const restart = input.body.restart === true;
	const text = restart
		? supportText(input.body.text ?? " ")
		: supportText(input.body.text);
	if (!text) {
		throw new Error("describe the bug");
	}
	const current = await readSupportChat(input);
	const starting =
		restart || current.status === "idle" || current.status === "completed";
	let stamp: number | undefined;
	if (starting && current.status !== "chatting") {
		stamp = await takeSupportSlot(input.env, input.userId);
		await rememberOpenSlot(input.env, input.userId, stamp);
	}
	const turn: SupportChatTurn = {
		text,
		surface,
		locale: supportLocale(input.body.locale),
		userId: input.userId,
		boardUuid:
			typeof input.body.boardUuid === "string" ? input.body.boardUuid : "",
		boardModel:
			typeof input.body.boardModel === "string" ? input.body.boardModel : "",
		restart: restart || current.status === "completed",
		mail: {
			accountId: input.env.CLOUDFLARE_ACCOUNT_ID?.trim() || "",
			token: input.env.CLOUDFLARE_EMAIL_API_TOKEN?.trim() || "",
			from: fromAddress(input.env),
			...(replyTo(input.userEmail)
				? { replyTo: replyTo(input.userEmail) }
				: {}),
		},
	};
	try {
		const next = await agentFetch(input.env, input.userId, "/turn", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(turn),
		});
		if (next.status === "completed") {
			await clearOpenSlot(input.env, input.userId);
		}
		return next;
	} catch (caught) {
		if (stamp !== undefined) {
			await refundSupportSlot(input.env, input.userId, stamp);
			await clearOpenSlot(input.env, input.userId);
		}
		throw caught;
	}
}

export async function supportChatResponse(
	handler: () => Promise<SupportChatState>,
): Promise<Response> {
	try {
		return jsonOk(await handler());
	} catch (caught) {
		return jsonFail(
			caught instanceof Error ? caught.message : "request failed",
			errorStatus(caught),
		);
	}
}
