"no action";

import { parseMarkup, type TokenUsage } from "gpio-companion";
import {
	bearerToken,
	userIdForAiAuth,
} from "../../../../../lib/ai-credentials.ts";
import {
	billedMicros,
	buildAiInput,
	type ChatBody,
	estimateUsage,
	extractUsage,
	normalizeSseLine,
	parseSseUsage,
	resolveModel,
	toChatCompletion,
} from "../../../../../lib/ai-proxy.ts";
import { recordAiUsage } from "../../../../../lib/ai-usage.ts";
import {
	consumeMicrodollars,
	creditsBalance,
} from "../../../../../lib/credits.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	DASHBOARD_DB?: D1Database;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
};

const CORS = {
	"access-control-allow-origin": "*",
	"access-control-allow-headers": "authorization,content-type",
	"access-control-allow-methods": "POST,OPTIONS",
};

export async function onRequestOptions() {
	return new Response(null, {
		status: 204,
		headers: CORS,
	});
}

export async function onRequestPost(ctx: { request: Request; env: PagesEnv }) {
	const key = bearerToken(ctx.request);
	if (!key) {
		return error(401, "missing api key");
	}
	const userId = await userIdForAiAuth(ctx.env, key);
	if (!userId) {
		return error(401, "unknown api key");
	}
	const markup = parseMarkup(ctx.env.GPIO_AI_MARKUP);
	const balance = await creditsBalance(ctx.env.DYNAMIC_PAGE_KV, userId);
	if (balance <= 0) {
		return error(402, "credits empty");
	}
	if (!ctx.env.AI) {
		return error(503, "workers ai is not bound");
	}
	let body: ChatBody;
	try {
		body = (await ctx.request.json()) as ChatBody;
	} catch {
		return error(400, "invalid json");
	}
	const model = resolveModel(body);
	const estimateTokens = estimateUsage(body);
	const estimate = billedMicros(model, estimateTokens, markup);
	if (estimate == null) {
		return error(400, "model not priced");
	}
	if (estimate > balance) {
		return error(402, "credits empty");
	}
	const stream = body.stream === true;
	const input = buildAiInput(body, stream);
	try {
		const result: unknown = await ctx.env.AI.run(
			model as keyof AiModels,
			input as never,
		);
		if (stream && result instanceof ReadableStream) {
			return sseResponse(
				ctx.env.DYNAMIC_PAGE_KV,
				ctx.env.DASHBOARD_DB,
				userId,
				model,
				markup,
				estimate,
				result,
			);
		}
		const usage = extractUsage(result) ?? estimateTokens;
		const debit = billedMicros(model, usage, markup) ?? estimate;
		await consumeMicrodollars(ctx.env.DYNAMIC_PAGE_KV, userId, debit);
		await recordAiUsage(ctx.env.DASHBOARD_DB, {
			userId,
			kind: "chat",
			model,
			promptTokens: usage.prompt_tokens,
			completionTokens: usage.completion_tokens,
			cachedTokens: usage.cached_tokens,
			micros: debit,
		});
		const completion = toChatCompletion(model, result);
		if (!extractUsage(completion)) {
			completion.usage = {
				prompt_tokens: usage.prompt_tokens,
				completion_tokens: usage.completion_tokens,
				total_tokens: usage.prompt_tokens + usage.completion_tokens,
			};
		}
		return Response.json(completion, { headers: CORS });
	} catch (caught) {
		const message =
			caught instanceof Error ? caught.message : "workers ai failed";
		return error(502, message);
	}
}

function sseResponse(
	kv: KVNamespace,
	db: D1Database | undefined,
	userId: string,
	model: string,
	markup: number,
	fallback: number,
	upstream: ReadableStream<unknown>,
): Response {
	const decoder = new TextDecoder();
	const encoder = new TextEncoder();
	let pending = "";
	let usage: TokenUsage | null = null;
	const billed = upstream.pipeThrough(
		new TransformStream<unknown, Uint8Array>({
			transform(chunk, controller) {
				const bytes =
					chunk instanceof Uint8Array
						? chunk
						: typeof chunk === "string"
							? encoder.encode(chunk)
							: encoder.encode(String(chunk ?? ""));
				pending += decoder.decode(bytes, { stream: true });
				let newline = pending.indexOf("\n");
				while (newline !== -1) {
					const line = pending.slice(0, newline);
					pending = pending.slice(newline + 1);
					const normalized = normalizeSseLine(line, model);
					usage = parseSseUsage(`${normalized}\n`, usage);
					controller.enqueue(encoder.encode(`${normalized}\n`));
					newline = pending.indexOf("\n");
				}
			},
			async flush(controller) {
				const tail = `${pending}${decoder.decode()}`.trimEnd();
				if (tail.length > 0) {
					const normalized = normalizeSseLine(tail, model);
					usage = parseSseUsage(`${normalized}\n`, usage);
					controller.enqueue(encoder.encode(`${normalized}\n`));
				}
				const debit =
					(usage ? billedMicros(model, usage, markup) : null) ?? fallback;
				await consumeMicrodollars(kv, userId, debit);
				await recordAiUsage(db, {
					userId,
					kind: "chat",
					model,
					promptTokens: usage?.prompt_tokens ?? 0,
					completionTokens: usage?.completion_tokens ?? 0,
					cachedTokens: usage?.cached_tokens,
					micros: debit,
				});
			},
		}),
	);
	return new Response(billed, {
		headers: {
			...CORS,
			"content-type": "text/event-stream",
			"cache-control": "no-cache",
		},
	});
}

function error(status: number, message: string): Response {
	return Response.json(
		{
			error: {
				message,
				type: status === 402 ? "insufficient_quota" : "invalid_request_error",
			},
		},
		{ status, headers: CORS },
	);
}
