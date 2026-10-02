import { expect, test } from "bun:test";
import { CODE_TTS_MAX_CHARS, codeSpeechChunks } from "./code-attach.ts";
import { CodeSpeechQueue, type CodeSpeechStatus } from "./code-speech.ts";

function deferred<T>() {
	let resolve!: (value: T) => void;
	let reject!: (error: unknown) => void;
	const promise = new Promise<T>((yes, no) => {
		resolve = yes;
		reject = no;
	});
	return { promise, resolve, reject };
}

const tick = () => Bun.sleep(0);

test("long replies are spoken completely in endpoint-sized chunks", () => {
	const text = "The circuit is ready. ".repeat(500).trim();
	const chunks = codeSpeechChunks(text);
	expect(chunks.length).toBeGreaterThan(1);
	expect(chunks.join(" ")).toBe(text);
	expect(chunks.every((chunk) => chunk.length <= CODE_TTS_MAX_CHARS)).toBe(
		true,
	);
	expect(codeSpeechChunks("```c\nint x = 1;\n``` https://example.com")).toEqual(
		[],
	);
	expect(
		codeSpeechChunks("x".repeat(CODE_TTS_MAX_CHARS + 1)).map(
			(chunk) => chunk.length,
		),
	).toEqual([CODE_TTS_MAX_CHARS, 1]);
});

function harness(
	fetch: (text: string) => Promise<string> = async (text) => text,
) {
	const requests: string[] = [];
	const errors: unknown[] = [];
	let status: CodeSpeechStatus = {
		speaking: false,
		paused: false,
		preparing: false,
		canReplay: false,
	};
	const players: {
		audio: string;
		paused: boolean;
		stopped: boolean;
		finish(): void;
	}[] = [];
	const queue = new CodeSpeechQueue({
		fetch: (text) => {
			requests.push(text);
			return fetch(text);
		},
		play: (audio) => {
			const end = deferred<void>();
			const player = {
				audio,
				paused: false,
				stopped: false,
				finish: () => end.resolve(),
			};
			players.push(player);
			queue.playback(true);
			return {
				finished: end.promise,
				pause: () => {
					player.paused = true;
				},
				resume: () => {
					player.paused = false;
					queue.playback(true);
				},
				stop: () => {
					player.stopped = true;
					end.resolve();
				},
			};
		},
		changed: (next) => {
			status = next;
		},
		failed: (error) => errors.push(error),
	});
	return { queue, requests, players, errors, status: () => status };
}

test("pause resumes the same player and holds subsequent streamed chunks", async () => {
	const h = harness();
	h.queue.enqueue("first");
	h.queue.enqueue("second");
	await tick();
	expect(h.players.map((p) => p.audio)).toEqual(["first"]);
	h.queue.pause();
	expect(h.players[0]?.paused).toBe(true);
	expect(h.status().speaking).toBe(false);
	h.queue.resume();
	expect(h.players).toHaveLength(1);
	expect(h.players[0]?.paused).toBe(false);
	h.queue.pause();
	h.players[0]?.finish(); // Also cover a pause at the exact chunk boundary.
	await tick();
	expect(h.players).toHaveLength(1);
	h.queue.resume();
	await tick();
	expect(h.players.map((p) => p.audio)).toEqual(["first", "second"]);
	h.queue.reset();
});

test("pausing during synthesis holds playback until resumed", async () => {
	const audio = deferred<string>();
	const h = harness(() => audio.promise);
	h.queue.enqueue("reply");
	await tick();
	expect(h.status().preparing).toBe(true);
	h.queue.pause();
	audio.resolve("audio");
	await tick();
	expect(h.players).toHaveLength(0);
	h.queue.resume();
	await tick();
	expect(h.players[0]?.audio).toBe("audio");
	h.queue.reset();
});

test("replay restarts the complete response and reuses synthesized audio", async () => {
	const h = harness();
	h.queue.enqueue("first");
	h.queue.enqueue("second");
	await tick();
	h.players[0]?.finish();
	await tick();
	h.players[1]?.finish();
	await tick();
	expect(h.status()).toMatchObject({
		speaking: false,
		preparing: false,
		canReplay: true,
	});
	h.queue.replay();
	await tick();
	expect(h.players[2]?.audio).toBe("first");
	h.players[2]?.finish();
	await tick();
	expect(h.players[3]?.audio).toBe("second");
	expect(h.requests).toEqual(["first", "second"]);
	h.queue.reset();
});

test("replay during playback stops the old player without overlapping queues", async () => {
	const h = harness();
	h.queue.enqueue("first");
	h.queue.enqueue("second");
	await tick();
	h.queue.replay();
	await tick();
	expect(h.players[0]?.stopped).toBe(true);
	expect(h.players.map((p) => p.audio)).toEqual(["first", "first"]);
	h.players[1]?.finish();
	await tick();
	expect(h.players.map((p) => p.audio)).toEqual(["first", "first", "second"]);
	expect(h.requests).toEqual(["first", "second"]);
	h.queue.reset();
});

test("session reset prevents late TTS results from playing or overwriting the new response", async () => {
	const old = deferred<string>();
	const h = harness(async (text) => (text === "old" ? old.promise : text));
	h.queue.enqueue("old");
	await tick();
	h.queue.pause();
	h.queue.reset();
	h.queue.enqueue("new");
	await tick();
	old.resolve("old-audio");
	await tick();
	expect(h.players.map((p) => p.audio)).toEqual(["new"]);
	expect(h.status().speaking).toBe(true);
	h.queue.replay();
	await tick();
	expect(h.players.map((p) => p.audio)).toEqual(["new", "new"]);
	h.queue.reset();
});

test("cancellation keeps replay available but never plays a late result automatically", async () => {
	const audio = deferred<string>();
	const h = harness(() => audio.promise);
	h.queue.enqueue("reply");
	await tick();
	h.queue.cancel();
	audio.resolve("audio");
	await tick();
	expect(h.players).toHaveLength(0);
	expect(h.status()).toEqual({
		speaking: false,
		paused: false,
		preparing: false,
		canReplay: true,
	});
	h.queue.replay();
	await tick();
	expect(h.players[0]?.audio).toBe("audio");
	expect(h.requests).toHaveLength(1);
	h.queue.reset();
});

test("failed synthesis can be retried with Replay", async () => {
	let attempt = 0;
	const h = harness(async () => {
		if (++attempt === 1) throw new Error("unavailable");
		return "audio";
	});
	h.queue.enqueue("reply");
	await tick();
	expect(h.errors).toHaveLength(1);
	expect(h.status().canReplay).toBe(true);
	h.queue.replay();
	await tick();
	expect(h.players[0]?.audio).toBe("audio");
	h.queue.reset();
});
