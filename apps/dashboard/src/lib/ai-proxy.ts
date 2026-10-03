import {
	costMicrodollars,
	DEFAULT_AI_MODEL,
	DEFAULT_MAX_COMPLETION_TOKENS,
	estimatePromptTokens,
	modelRate,
	type TokenUsage,
} from "gpio-companion";

export type ChatBody = {
	model?: string;
	messages?: unknown;
	tools?: unknown;
	tool_choice?: unknown;
	max_tokens?: number | null;
	max_completion_tokens?: number | null;
	temperature?: number | null;
	top_p?: number | null;
	frequency_penalty?: number | null;
	presence_penalty?: number | null;
	stop?: unknown;
	parallel_tool_calls?: boolean;
	response_format?: unknown;
	seed?: number | null;
	n?: number | null;
	stream?: boolean | null;
	stream_options?: { include_usage?: boolean };
	reasoning_effort?: "low" | "medium" | "high" | null;
	reasoningEffort?: "low" | "medium" | "high" | null;
};

type LegacyToolCall = {
	name?: string;
	arguments?: unknown;
};

type OpenAiToolCall = {
	id: string;
	type: "function";
	function: { name: string; arguments: string };
};

export function resolveModel(body: ChatBody): string {
	const model = body.model?.trim() || DEFAULT_AI_MODEL;
	return model;
}

export function maxCompletionTokens(body: ChatBody): number {
	const value = body.max_completion_tokens ?? body.max_tokens;
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		return Math.floor(value);
	}
	return DEFAULT_MAX_COMPLETION_TOKENS;
}

export function estimateUsage(body: ChatBody): TokenUsage {
	return {
		prompt_tokens: estimatePromptTokens({
			messages: body.messages,
			tools: body.tools,
		}),
		completion_tokens: maxCompletionTokens(body),
	};
}

export function resolveReasoningEffort(
	body: ChatBody,
): "low" | "medium" | "high" | undefined {
	const raw = body.reasoning_effort ?? body.reasoningEffort;
	if (raw === "low" || raw === "medium" || raw === "high") {
		return raw;
	}
	return undefined;
}

export function billedMicros(
	model: string,
	usage: TokenUsage,
	markup: number,
): number | null {
	if (!modelRate(model)) {
		return null;
	}
	return costMicrodollars(model, usage, markup);
}

export function buildAiInput(
	body: ChatBody,
	stream: boolean,
): Record<string, unknown> {
	const input: Record<string, unknown> = {
		messages: body.messages ?? [],
	};
	if (body.tools !== undefined) {
		input.tools = body.tools;
	}
	if (body.tool_choice !== undefined) {
		input.tool_choice = body.tool_choice;
	}
	if (body.max_completion_tokens != null) {
		input.max_completion_tokens = body.max_completion_tokens;
	} else if (body.max_tokens != null) {
		input.max_tokens = body.max_tokens;
	}
	if (body.temperature != null) {
		input.temperature = body.temperature;
	}
	if (body.top_p != null) {
		input.top_p = body.top_p;
	}
	if (body.frequency_penalty != null) {
		input.frequency_penalty = body.frequency_penalty;
	}
	if (body.presence_penalty != null) {
		input.presence_penalty = body.presence_penalty;
	}
	if (body.stop !== undefined) {
		input.stop = body.stop;
	}
	if (body.parallel_tool_calls !== undefined) {
		input.parallel_tool_calls = body.parallel_tool_calls;
	}
	if (body.response_format !== undefined) {
		input.response_format = body.response_format;
	}
	if (body.seed != null) {
		input.seed = body.seed;
	}
	if (body.n != null) {
		input.n = body.n;
	}
	const effort = resolveReasoningEffort(body);
	if (effort) {
		input.reasoning_effort = effort;
	}
	if (stream) {
		input.stream = true;
		input.stream_options = { include_usage: true, ...body.stream_options };
	}
	return input;
}

export function extractUsage(value: unknown): TokenUsage | null {
	if (!value || typeof value !== "object") {
		return null;
	}
	type UsageShape = {
		prompt_tokens?: number;
		completion_tokens?: number;
		cached_tokens?: number;
		prompt_tokens_details?: { cached_tokens?: number };
		usage?: UsageShape;
	};
	const record = value as UsageShape;
	const usage = record.usage ?? record;
	const prompt = Number(usage.prompt_tokens);
	const completion = Number(usage.completion_tokens);
	if (!Number.isFinite(prompt) && !Number.isFinite(completion)) {
		return null;
	}
	const cached = Number(
		usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
	);
	return {
		prompt_tokens: Number.isFinite(prompt) ? Math.max(0, prompt) : 0,
		completion_tokens: Number.isFinite(completion)
			? Math.max(0, completion)
			: 0,
		cached_tokens: Number.isFinite(cached) ? Math.max(0, cached) : 0,
	};
}

function mapToolCalls(value: unknown): OpenAiToolCall[] | undefined {
	if (!Array.isArray(value) || value.length === 0) {
		return undefined;
	}
	if (
		value.every(
			(item) =>
				item &&
				typeof item === "object" &&
				"type" in item &&
				"function" in item,
		)
	) {
		return value as OpenAiToolCall[];
	}
	return (value as LegacyToolCall[]).map((call, index) => ({
		id: `call_${index}`,
		type: "function" as const,
		function: {
			name: String(call.name ?? ""),
			arguments:
				typeof call.arguments === "string"
					? call.arguments
					: JSON.stringify(call.arguments ?? {}),
		},
	}));
}

function assistantText(result: unknown): string | null {
	if (typeof result === "string") {
		return result;
	}
	if (result && typeof result === "object" && "response" in result) {
		const text = (result as { response: unknown }).response;
		return text == null ? null : String(text);
	}
	return null;
}

export function toChatCompletion(
	model: string,
	result: unknown,
): Record<string, unknown> {
	if (result && typeof result === "object" && "choices" in result) {
		const record = result as Record<string, unknown>;
		return {
			...record,
			id:
				typeof record.id === "string"
					? record.id
					: `gpio-${crypto.randomUUID()}`,
			object: record.object ?? "chat.completion",
			created:
				typeof record.created === "number"
					? record.created
					: Math.floor(Date.now() / 1000),
			model: typeof record.model === "string" ? record.model : model,
		};
	}
	const toolCalls = mapToolCalls(
		result && typeof result === "object" && "tool_calls" in result
			? (result as { tool_calls: unknown }).tool_calls
			: undefined,
	);
	const text = assistantText(result);
	const usage = extractUsage(result);
	return {
		id: `gpio-${crypto.randomUUID()}`,
		object: "chat.completion",
		created: Math.floor(Date.now() / 1000),
		model,
		choices: [
			{
				index: 0,
				message: {
					role: "assistant",
					content: toolCalls?.length ? null : (text ?? ""),
					...(toolCalls ? { tool_calls: toolCalls } : {}),
				},
				finish_reason: toolCalls?.length ? "tool_calls" : "stop",
			},
		],
		usage: {
			prompt_tokens: usage?.prompt_tokens ?? 0,
			completion_tokens: usage?.completion_tokens ?? 0,
			total_tokens:
				(usage?.prompt_tokens ?? 0) + (usage?.completion_tokens ?? 0),
		},
	};
}

export function toChatChunk(model: string, payload: unknown): unknown {
	if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
		return payload;
	}
	const record = payload as Record<string, unknown>;
	if ("choices" in record || "error" in record) {
		return record;
	}
	const usage = extractUsage(record);
	if (usage) {
		return {
			id: `gpio-chunk-${crypto.randomUUID()}`,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [],
			usage: {
				prompt_tokens: usage.prompt_tokens,
				completion_tokens: usage.completion_tokens,
				total_tokens: usage.prompt_tokens + usage.completion_tokens,
			},
		};
	}
	const text = assistantText(record);
	if (text != null) {
		return {
			id: `gpio-chunk-${crypto.randomUUID()}`,
			object: "chat.completion.chunk",
			created: Math.floor(Date.now() / 1000),
			model,
			choices: [
				{
					index: 0,
					delta: { role: "assistant", content: text },
					finish_reason: null,
				},
			],
		};
	}
	return record;
}

export function normalizeSseLine(line: string, model: string): string {
	const trimmed = line.trimStart();
	if (!trimmed.startsWith("data:")) {
		return line;
	}
	const payload = trimmed.slice(5).trim();
	if (!payload || payload === "[DONE]") {
		return line;
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(payload);
	} catch {
		return line;
	}
	return `data: ${JSON.stringify(toChatChunk(model, parsed))}`;
}

export function parseSseUsage(
	chunk: string,
	current: TokenUsage | null,
): TokenUsage | null {
	let usage = current;
	for (const line of chunk.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed.startsWith("data:")) {
			continue;
		}
		const payload = trimmed.slice(5).trim();
		if (!payload || payload === "[DONE]") {
			continue;
		}
		try {
			const parsed = JSON.parse(payload) as unknown;
			const next = extractUsage(parsed);
			if (next) {
				usage = next;
			}
		} catch {
			// ignore partial SSE JSON
		}
	}
	return usage;
}
