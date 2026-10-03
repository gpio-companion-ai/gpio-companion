import { describe, expect, test } from "bun:test";
import {
	billedMicros,
	buildAiInput,
	estimateUsage,
	extractUsage,
	normalizeSseLine,
	parseSseUsage,
	resolveModel,
	toChatChunk,
	toChatCompletion,
} from "./ai-proxy.ts";

describe("ai proxy", () => {
	test("defaults to glm-5.3", () => {
		expect(resolveModel({})).toBe("@cf/zai-org/glm-5.3");
	});

	test("forwards tools", () => {
		const input = buildAiInput(
			{
				messages: [{ role: "user", content: "hi" }],
				tools: [{ type: "function", function: { name: "bash" } }],
				tool_choice: "auto",
			},
			false,
		);
		expect(input.tools).toEqual([
			{ type: "function", function: { name: "bash" } },
		]);
		expect(input.stream).toBeUndefined();
	});

	test("maps legacy tool_calls", () => {
		const completion = toChatCompletion("@cf/zai-org/glm-5.3", {
			response: "",
			tool_calls: [{ name: "bash", arguments: { command: "ls" } }],
			usage: { prompt_tokens: 10, completion_tokens: 4 },
		});
		const choice = (completion.choices as Array<{ finish_reason: string }>)[0];
		expect(choice?.finish_reason).toBe("tool_calls");
	});

	test("extracts cached usage", () => {
		expect(
			extractUsage({
				usage: {
					prompt_tokens: 100,
					completion_tokens: 9,
					prompt_tokens_details: { cached_tokens: 40 },
				},
			}),
		).toEqual({
			prompt_tokens: 100,
			completion_tokens: 9,
			cached_tokens: 40,
		});
	});

	test("parses sse usage", () => {
		expect(
			parseSseUsage(
				`data: {"choices":[{"delta":{"content":"a"}}]}\ndata: {"usage":{"prompt_tokens":3,"completion_tokens":2}}\n`,
				null,
			),
		).toEqual({ prompt_tokens: 3, completion_tokens: 2, cached_tokens: 0 });
	});

	test("bills unknown model as null", () => {
		expect(
			billedMicros("nope", { prompt_tokens: 1, completion_tokens: 1 }, 1.25),
		).toBeNull();
	});

	test("estimateUsage is positive", () => {
		expect(
			estimateUsage({ messages: [{ role: "user", content: "hello world" }] })
				.prompt_tokens,
		).toBeGreaterThan(0);
	});

	test("forwards reasoning_effort", () => {
		expect(
			buildAiInput(
				{
					messages: [{ role: "user", content: "hi" }],
					reasoning_effort: "high",
				},
				false,
			).reasoning_effort,
		).toBe("high");
	});

	test("accepts OpenCode reasoningEffort camelCase", () => {
		expect(
			buildAiInput(
				{
					messages: [{ role: "user", content: "hi" }],
					reasoningEffort: "low",
				},
				false,
			).reasoning_effort,
		).toBe("low");
	});

	test("drops invalid reasoning effort", () => {
		expect(
			buildAiInput(
				{
					messages: [{ role: "user", content: "hi" }],
					reasoning_effort: "nope" as never,
				},
				false,
			).reasoning_effort,
		).toBeUndefined();
	});

	test("normalizes workers ai native final usage chunk", () => {
		const line = normalizeSseLine(
			'data: {"response":"","usage":{"prompt_tokens":1893,"completion_tokens":12,"total_tokens":1905,"prompt_tokens_details":{"cached_tokens":0},"neurons":26.359089493751526}}',
			"@cf/zai-org/glm-5.3-flash",
		);
		expect(line.startsWith("data: ")).toBe(true);
		const chunk = JSON.parse(line.slice(6)) as {
			choices: unknown[];
			usage: { prompt_tokens: number; completion_tokens: number };
			object: string;
		};
		expect(chunk.object).toBe("chat.completion.chunk");
		expect(Array.isArray(chunk.choices)).toBe(true);
		expect(chunk.usage.prompt_tokens).toBe(1893);
		expect(chunk.usage.completion_tokens).toBe(12);
	});

	test("passes openai-shaped chunks through untouched", () => {
		const payload =
			'{"choices":[{"delta":{"content":"hi"},"finish_reason":null,"index":0}],"id":"abc","object":"chat.completion.chunk"}';
		expect(normalizeSseLine(`data: ${payload}`, "m")).toBe(`data: ${payload}`);
	});

	test("converts native delta chunks to content deltas", () => {
		const line = normalizeSseLine(
			'data: {"response":"hello"}',
			"@cf/zai-org/glm-5.3",
		);
		const chunk = JSON.parse(line.slice(6)) as {
			choices: Array<{ delta: { content: string }; finish_reason: null }>;
		};
		expect(chunk.choices[0]?.delta.content).toBe("hello");
		expect(chunk.choices[0]?.finish_reason).toBeNull();
	});

	test("keeps done and non-data lines unchanged", () => {
		expect(normalizeSseLine("data: [DONE]", "m")).toBe("data: [DONE]");
		expect(normalizeSseLine("", "m")).toBe("");
		expect(normalizeSseLine(": keepalive", "m")).toBe(": keepalive");
		expect(normalizeSseLine("data: not-json", "m")).toBe("data: not-json");
	});

	test("billing usage survives normalization", () => {
		const normalized = normalizeSseLine(
			'data: {"response":"","usage":{"prompt_tokens":14,"completion_tokens":16,"total_tokens":30,"neurons":0.9}}',
			"m",
		);
		expect(parseSseUsage(`${normalized}\n`, null)).toEqual({
			prompt_tokens: 14,
			completion_tokens: 16,
			cached_tokens: 0,
		});
	});

	test("toChatChunk leaves error payloads alone", () => {
		const payload = { error: { message: "boom" } };
		expect(toChatChunk("m", payload)).toBe(payload);
	});

	test("normalizes native chunk with null response", () => {
		const line = normalizeSseLine(
			'data: {"response":null,"usage":{"prompt_tokens":7,"completion_tokens":2}}',
			"m",
		);
		const chunk = JSON.parse(line.slice(6)) as {
			choices: unknown[];
			usage: { prompt_tokens: number };
		};
		expect(chunk.choices).toEqual([]);
		expect(chunk.usage.prompt_tokens).toBe(7);
	});

	test("converts empty native delta to an empty content delta", () => {
		const line = normalizeSseLine('data: {"response":""}', "m");
		const chunk = JSON.parse(line.slice(6)) as {
			choices: Array<{ delta: { content: string }; finish_reason: null }>;
		};
		expect(chunk.choices[0]?.delta.content).toBe("");
		expect(chunk.choices[0]?.finish_reason).toBeNull();
	});
});
