import { describe, expect, test } from "bun:test";
import { parseMarkup } from "gpio-companion";
import { onRequestPost } from "../../../actions/api/ai/v1/chat/completions.ts";
import { billedMicros, estimateUsage } from "../../../lib/ai-proxy.ts";
import {
	creditsBalance,
	grantUsd,
	registerAiKey,
} from "../../../lib/credits.ts";

const MODEL = "@cf/zai-org/glm-5.3-flash";

class MemoryKv {
	store = new Map<string, string>();
	async get(key: string) {
		return this.store.get(key) ?? null;
	}
	async put(key: string, value: string) {
		this.store.set(key, value);
	}
}

const ROLE_CHUNK =
	'{"choices":[{"delta":{"content":"","reasoning_content":null,"role":"assistant"},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1790996567,"id":"2e6734ec658642b995b4f462c336cb04","model":"@cf/zai-org/glm-5.3-flash","object":"chat.completion.chunk","p":"m6yrlv8lur9xfkv0smyoh5vb562uu4u3y3tsj7zffh6rexgj0j","usage":{"prompt_tokens":14,"completion_tokens":0,"total_tokens":14,"prompt_tokens_details":{"cached_tokens":0},"neurons":0.19090907275676727}}';
const REASONING_CHUNK =
	'{"choices":[{"delta":{"reasoning_content":"The user said \\"Say hi.\\" This is a simple, friendly greeting request."},"finish_reason":null,"index":0,"logprobs":null,"matched_stop":null}],"created":1790996567,"id":"2e6734ec658642b995b4f462c336cb04","model":"@cf/zai-org/glm-5.3-flash","object":"chat.completion.chunk","p":"b9gio49zildaixbgts3zdzmvnvtvtt4l09p1znurt","usage":{"prompt_tokens":0,"completion_tokens":7,"total_tokens":7,"prompt_tokens_details":{"cached_tokens":0},"neurons":0.3181818425655365}}';
const FINISH_CHUNK =
	'{"choices":[{"delta":{"reasoning_content":null},"finish_reason":"length","index":0,"logprobs":null,"matched_stop":null}],"created":1790996567,"id":"2e6734ec658642b995b4f462c336cb04","model":"@cf/zai-org/glm-5.3-flash","object":"chat.completion.chunk","p":"r2ajil5kha448igu2igm9trli4x14oui217jf2g9","usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"neurons":0}}';
const EMPTY_CHOICES_CHUNK =
	'{"choices":[],"created":1790996567,"id":"2e6734ec658642b995b4f462c336cb04","model":"@cf/zai-org/glm-5.3-flash","object":"chat.completion.chunk","p":"360s8p","usage":{"prompt_tokens":0,"completion_tokens":0,"total_tokens":0,"prompt_tokens_details":{"cached_tokens":0},"neurons":0}}';
// Exact payload from the 2026-10-03 incident: Workers AI native final usage
// chunk (no choices array) that aborted every opencode tool call.
const NATIVE_FINAL_CHUNK =
	'{"response":"","usage":{"prompt_tokens":14,"completion_tokens":16,"total_tokens":30,"prompt_tokens_details":{"cached_tokens":0},"neurons":0.9181818701326847}}';

function wireStreamText(): string {
	return [
		`data: ${ROLE_CHUNK}`,
		``,
		`data: ${REASONING_CHUNK}`,
		``,
		`data: ${FINISH_CHUNK}`,
		``,
		`data: ${EMPTY_CHOICES_CHUNK}`,
		``,
		`data: ${NATIVE_FINAL_CHUNK}`,
		``,
		"data: [DONE]",
		``,
	].join("\n");
}

function streamFrom(pieces: string[]): ReadableStream<Uint8Array> {
	const encoder = new TextEncoder();
	return new ReadableStream<Uint8Array>({
		start(controller) {
			for (const piece of pieces) {
				controller.enqueue(encoder.encode(piece));
			}
			controller.close();
		},
	});
}

function sliceBytes(text: string, size: number): string[] {
	const pieces: string[] = [];
	for (let index = 0; index < text.length; index += size) {
		pieces.push(text.slice(index, index + size));
	}
	return pieces;
}

function dataLines(body: string): string[] {
	return body.split("\n").filter((line) => line.startsWith("data:"));
}

function parseDataLine(line: string): Record<string, unknown> {
	return JSON.parse(line.slice(5).trim()) as Record<string, unknown>;
}

async function setupUser(kv: MemoryKv): Promise<string> {
	await registerAiKey(kv as unknown as KVNamespace, "user-1", "gpio-key");
	await grantUsd(kv as unknown as KVNamespace, "user-1", 5);
	return "Bearer gpio-key";
}

async function postChat(
	kv: MemoryKv,
	authorization: string,
	body: unknown,
	run: (model: string, input: unknown) => Promise<unknown>,
): Promise<Response> {
	return onRequestPost({
		request: new Request(
			"https://gpio-companion.com/api/ai/v1/chat/completions",
			{
				method: "POST",
				headers: { authorization, "content-type": "application/json" },
				body: JSON.stringify(body),
			},
		),
		env: {
			DYNAMIC_PAGE_KV: kv as unknown as KVNamespace,
			AI: { run } as unknown as Ai,
		},
	});
}

describe("POST /api/ai/v1/chat/completions (streaming)", () => {
	test("2026-10-03 incident: native final usage chunk is normalized, every data line stays openai-shaped", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const before = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const response = await postChat(
			kv,
			authorization,
			{
				model: MODEL,
				messages: [{ role: "user", content: "Say hi" }],
				max_tokens: 16,
				stream: true,
			},
			async () => streamFrom([wireStreamText()]),
		);
		expect(response.status).toBe(200);
		expect(response.headers.get("content-type")).toBe("text/event-stream");
		const body = await response.text();
		const lines = dataLines(body);
		expect(lines[lines.length - 1]).toBe("data: [DONE]");
		const chunks = lines.slice(0, -1).map(parseDataLine);
		for (const chunk of chunks) {
			expect(Array.isArray(chunk.choices)).toBe(true);
			expect("response" in chunk).toBe(false);
		}
		const finalUsage = chunks[chunks.length - 1] as {
			choices: unknown[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(finalUsage.choices).toEqual([]);
		expect(finalUsage.usage.prompt_tokens).toBe(14);
		expect(finalUsage.usage.completion_tokens).toBe(16);
		const after = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const markup = parseMarkup(undefined);
		expect(after).toBe(
			before -
				(billedMicros(
					MODEL,
					{ prompt_tokens: 14, completion_tokens: 16, cached_tokens: 0 },
					markup,
				) ?? 0),
		);
	});

	test("survives transport chunk boundaries that split json mid-line", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const response = await postChat(
			kv,
			authorization,
			{
				model: MODEL,
				messages: [{ role: "user", content: "Say hi" }],
				max_tokens: 16,
				stream: true,
			},
			async () => streamFrom(sliceBytes(wireStreamText(), 7)),
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		const lines = dataLines(body);
		expect(lines[lines.length - 1]).toBe("data: [DONE]");
		const chunks = lines.slice(0, -1).map(parseDataLine);
		expect(chunks.length).toBe(5);
		for (const chunk of chunks) {
			expect(Array.isArray(chunk.choices)).toBe(true);
		}
		const finalUsage = chunks[chunks.length - 1] as {
			choices: unknown[];
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(finalUsage.usage.prompt_tokens).toBe(14);
		expect(finalUsage.usage.completion_tokens).toBe(16);
	});

	test("flushes a trailing line that never received its newline", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const text = wireStreamText().replace(/\n$/, "");
		const response = await postChat(
			kv,
			authorization,
			{
				model: MODEL,
				messages: [{ role: "user", content: "Say hi" }],
				max_tokens: 16,
				stream: true,
			},
			async () => streamFrom([text]),
		);
		expect(response.status).toBe(200);
		const body = await response.text();
		expect(body.endsWith("data: [DONE]\n")).toBe(true);
	});

	test("bills the estimate when the stream carries no usage at all", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const before = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const chatBody = {
			model: MODEL,
			messages: [{ role: "user", content: "hello" }],
			max_tokens: 8,
			stream: true,
		};
		const usageless = `data: ${JSON.stringify({
			id: "abc",
			object: "chat.completion.chunk",
			model: MODEL,
			choices: [{ index: 0, delta: { content: "hi" }, finish_reason: null }],
		})}\n\ndata: [DONE]\n\n`;
		const response = await postChat(kv, authorization, chatBody, async () =>
			streamFrom([usageless]),
		);
		expect(response.status).toBe(200);
		await response.text();
		const after = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const markup = parseMarkup(undefined);
		const estimate = billedMicros(
			MODEL,
			estimateUsage(chatBody as never),
			markup,
		);
		expect(estimate).not.toBeNull();
		expect(after).toBe(before - (estimate ?? 0));
	});
});

describe("POST /api/ai/v1/chat/completions (non-streaming)", () => {
	test("maps a native workers ai result to a chat completion", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const before = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const response = await postChat(
			kv,
			authorization,
			{
				model: MODEL,
				messages: [{ role: "user", content: "hi" }],
				stream: false,
			},
			async () => ({
				response: "hello there",
				usage: { prompt_tokens: 5, completion_tokens: 3 },
			}),
		);
		expect(response.status).toBe(200);
		const completion = (await response.json()) as {
			object: string;
			choices: Array<{ message: { content: string } }>;
			usage: { prompt_tokens: number; completion_tokens: number };
		};
		expect(completion.object).toBe("chat.completion");
		expect(completion.choices[0]?.message.content).toBe("hello there");
		expect(completion.usage.prompt_tokens).toBe(5);
		expect(completion.usage.completion_tokens).toBe(3);
		const after = await creditsBalance(kv as unknown as KVNamespace, "user-1");
		const markup = parseMarkup(undefined);
		expect(after).toBe(
			before -
				(billedMicros(
					MODEL,
					{ prompt_tokens: 5, completion_tokens: 3, cached_tokens: 0 },
					markup,
				) ?? 0),
		);
	});
});

describe("POST /api/ai/v1/chat/completions (guards)", () => {
	test("401 without api key", async () => {
		const kv = new MemoryKv();
		const response = await postChat(
			kv,
			"",
			{
				model: MODEL,
				messages: [],
			},
			async () => "unused",
		);
		expect(response.status).toBe(401);
	});

	test("401 with unknown api key", async () => {
		const kv = new MemoryKv();
		const response = await postChat(
			kv,
			"Bearer nope",
			{
				model: MODEL,
				messages: [],
			},
			async () => "unused",
		);
		expect(response.status).toBe(401);
	});

	test("402 when credits are empty", async () => {
		const kv = new MemoryKv();
		await registerAiKey(kv as unknown as KVNamespace, "user-1", "gpio-key");
		const response = await postChat(
			kv,
			"Bearer gpio-key",
			{
				model: MODEL,
				messages: [{ role: "user", content: "hi" }],
			},
			async () => "unused",
		);
		expect(response.status).toBe(402);
	});

	test("400 for an unpriced model", async () => {
		const kv = new MemoryKv();
		const authorization = await setupUser(kv);
		const response = await postChat(
			kv,
			authorization,
			{
				model: "not-a-model",
				messages: [{ role: "user", content: "hi" }],
			},
			async () => "unused",
		);
		expect(response.status).toBe(400);
	});
});
