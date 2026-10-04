"no action";

import {
	DEFAULT_EMBEDDING_MODEL,
	embeddingCostMicrodollars,
	embeddingModelInfo,
	estimateEmbeddingTokens,
	MAX_EMBEDDING_INPUTS,
	parseMarkup,
} from "gpio-companion";
import {
	bearerToken,
	userIdForAiAuth,
} from "../../../../lib/ai-credentials.ts";
import { recordAiUsage } from "../../../../lib/ai-usage.ts";
import {
	consumeMicrodollars,
	creditsBalance,
} from "../../../../lib/credits.ts";

type PagesEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	DASHBOARD_DB?: D1Database;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
};

type EmbeddingsBody = {
	model?: string;
	input?: unknown;
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
	let body: EmbeddingsBody;
	try {
		body = (await ctx.request.json()) as EmbeddingsBody;
	} catch {
		return error(400, "invalid json");
	}
	const model = body.model?.trim() || DEFAULT_EMBEDDING_MODEL;
	const info = embeddingModelInfo(model);
	if (!info) {
		return error(400, "model not priced");
	}
	const inputs = normalizeInputs(body.input);
	if (!inputs) {
		return error(400, "input must be a string or a non-empty array of strings");
	}
	if (inputs.length > MAX_EMBEDDING_INPUTS) {
		return error(400, `input accepts at most ${MAX_EMBEDDING_INPUTS} values`);
	}
	const tokens = estimateEmbeddingTokens(inputs);
	const estimate = embeddingCostMicrodollars(model, tokens, markup);
	if (estimate == null) {
		return error(400, "model not priced");
	}
	if (estimate > balance) {
		return error(402, "credits empty");
	}
	try {
		const result: unknown = await ctx.env.AI.run(
			model as keyof AiModels,
			{
				text: inputs,
			} as never,
		);
		const vectors = extractVectors(result);
		if (!vectors || vectors.length !== inputs.length) {
			return error(502, "workers ai returned no embeddings");
		}
		await consumeMicrodollars(ctx.env.DYNAMIC_PAGE_KV, userId, estimate);
		await recordAiUsage(ctx.env.DASHBOARD_DB, {
			userId,
			kind: "embedding",
			model,
			promptTokens: tokens,
			micros: estimate,
		});
		return Response.json(
			{
				object: "list",
				data: vectors.map((embedding, index) => ({
					object: "embedding",
					index,
					embedding,
				})),
				model,
				usage: {
					prompt_tokens: tokens,
					total_tokens: tokens,
				},
			},
			{ headers: CORS },
		);
	} catch (caught) {
		const message =
			caught instanceof Error ? caught.message : "workers ai failed";
		return error(502, message);
	}
}

function normalizeInputs(input: unknown): string[] | null {
	if (typeof input === "string") {
		return input ? [input] : null;
	}
	if (!Array.isArray(input) || input.length === 0) {
		return null;
	}
	const values: string[] = [];
	for (const value of input) {
		if (typeof value !== "string" || !value) {
			return null;
		}
		values.push(value);
	}
	return values;
}

function extractVectors(result: unknown): number[][] | null {
	if (!result || typeof result !== "object") {
		return null;
	}
	const data = (result as { data?: unknown }).data;
	if (!Array.isArray(data) || data.length === 0) {
		return null;
	}
	const vectors: number[][] = [];
	for (const vector of data) {
		if (!Array.isArray(vector)) {
			return null;
		}
		vectors.push(vector as number[]);
	}
	return vectors;
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
