import { describe, expect, test } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openPromptStore } from "./prompt-store.ts";

const asked = {
	type: "question.asked",
	properties: {
		id: "que_1",
		sessionID: "ses_1",
		questions: [
			{
				header: "LED",
				question: "Which pin?",
				options: [{ label: "7" }],
			},
		],
	},
};

describe("opencode prompt store", () => {
	test("saves a question on the board and drops it after reply", async () => {
		const dir = await mkdtemp(join(tmpdir(), "gpio-prompts-"));
		const store = openPromptStore(join(dir, "opencode.sqlite"));
		store.save("blink-led", asked);
		store.sync("blink-led", "permission", [
			{
				id: "per_1",
				sessionID: "ses_1",
				permission: "bash",
				patterns: ["git push"],
			},
		]);
		expect(store.list("blink-led", "question")).toEqual([asked.properties]);
		expect(store.list("other", "question")).toEqual([]);
		expect(store.list("blink-led", "permission")).toEqual([
			{
				id: "per_1",
				sessionID: "ses_1",
				permission: "bash",
				patterns: ["git push"],
			},
		]);
		store.save("blink-led", {
			type: "question.replied",
			properties: { sessionID: "ses_1", requestID: "que_1" },
		});
		expect(store.list("blink-led", "question")).toEqual([]);
		store.drop("per_1");
		expect(store.list("blink-led", "permission")).toEqual([]);
		store.close();
	});
});
