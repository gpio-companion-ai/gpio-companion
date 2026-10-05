import { DurableObject } from "cloudflare:workers";
import { Type } from "@earendil-works/pi-ai";
import { createModels } from "@earendil-works/pi-ai/models";
import { createRegistry, Harness } from "@earendil-works/pi-durable";
import { PiHarness, skills } from "agents/harness/pi";
import { Lifecycle } from "agents/lifecycle";
import { createAI } from "agents/models/pi-ai";
import {
	deliverSupportEmail,
	parseSupportSummary,
	partialSummary,
	SUPPORT_CHAT_MESSAGE_CAP,
	SUPPORT_CHAT_MODEL_MAX,
	type SupportChatLive,
	type SupportChatLiveTool,
	type SupportChatMessage,
	type SupportChatState,
	type SupportChatSummary,
	type SupportChatTurn,
	supportBoardUuid,
	supportLocale,
	supportReportId,
	supportReportMail,
	supportSurface,
	supportText,
	userMessageCount,
} from "gpio-companion";
import { type OpenVikingBinding, queryOpenViking } from "./ov.ts";
import { saveSupportReport } from "./reports.ts";
import { lookupSkill } from "./skill.ts";

type MailConfig = NonNullable<SupportChatTurn["mail"]>;

type AgentDispatch = {
	userId?: string;
	kind?: string;
	title?: string;
	description?: string;
	steps?: string[];
	expected?: string;
	actual?: string;
	severity?: string;
	surface?: string;
	board?: string;
	console?: { level?: string; text?: string }[];
	network?: { method?: string; path?: string; status?: number }[];
	mail?: MailConfig;
};

type StoredChat = {
	v: 1;
	messages: SupportChatMessage[];
	summary?: SupportChatSummary;
	sentId?: string;
};

export type Env = {
	AI: Ai;
	SUPPORT_AGENT: DurableObjectNamespace<SupportAgent>;
	OPENVIKING?: OpenVikingBinding;
	OPENVIKING_API_KEY?: string;
	DASHBOARD_DB?: D1Database;
	SUPPORT_MODEL?: string;
	SUPPORT_FROM_EMAIL?: string;
};

const CHAT_KEY = "support-chat";
const LIVE_KEY = "support-live";
const MODEL = "@cf/zai-org/glm-5.3-flash";

function emptyChat(): StoredChat {
	return { v: 1, messages: [] };
}

function boardLabel(turn: SupportChatTurn): string {
	const uuid = supportBoardUuid(turn.boardUuid);
	const model =
		typeof turn.boardModel === "string"
			? turn.boardModel.trim().slice(0, SUPPORT_CHAT_MODEL_MAX)
			: "";
	return [uuid, model].filter(Boolean).join(" ");
}

function textResult(text: string, isError = false) {
	return {
		content: [{ type: "text" as const, text }],
		isError,
	};
}

export class SupportAgent extends DurableObject<Env> {
	private locale: "en" | "fr" = "en";
	private surface: SupportChatTurn["surface"] = "web";
	private userId = "";
	private board = "";
	private mail: MailConfig | null = null;
	private notes: SupportChatMessage[] = [];
	private live: SupportChatLive = { draft: "", tools: [] };
	private generation = 0;
	private turnGeneration = 0;

	private readonly ai = createAI({ binding: this.env.AI });
	private readonly registry = createRegistry();
	private readonly harness = new PiHarness({
		harness: async ({ storage, context }) => {
			this.registry.install(await skills([lookupSkill]));
			this.registry.install({
				name: "support",
				sections: [
					{
						key: "preamble",
						tag: false,
						render: () => this.preamble(),
					},
				],
				tools: [
					this.findTool(),
					this.grepTool(),
					this.readTool(),
					this.completeTool(),
				],
			});
			const models = createModels();
			models.setProvider(this.ai.provider);
			return Harness.open(
				storage,
				{ models, registry: this.registry },
				context,
			);
		},
		defaults: {
			model: this.ai(this.env.SUPPORT_MODEL || MODEL),
			thinkingLevel: "low",
		},
	});

	private readonly lifecycle = Lifecycle.install(this).use(this.harness);

	override async fetch(request: Request): Promise<Response> {
		void this.lifecycle;
		const url = new URL(request.url);
		try {
			if (url.pathname === "/state" && request.method === "GET") {
				return Response.json(await this.snapshot());
			}
			if (url.pathname === "/turn" && request.method === "POST") {
				const body = (await request.json()) as SupportChatTurn;
				return Response.json(await this.handleTurn(body));
			}
			if (url.pathname === "/cancel" && request.method === "POST") {
				return Response.json(await this.cancelChat());
			}
			if (url.pathname === "/dispatch" && request.method === "POST") {
				const body = (await request.json()) as AgentDispatch;
				return Response.json(await this.dispatch(body));
			}
			return Response.json({ error: "not found" }, { status: 404 });
		} catch (caught) {
			const message =
				caught instanceof Error ? caught.message : "request failed";
			const status =
				message === "support email is not configured" ||
				message === "workers ai is not bound"
					? 503
					: 400;
			return Response.json({ error: message }, { status });
		}
	}

	private preamble(): string {
		const language = this.locale === "fr" ? "French" : "English";
		return [
			"You are the gpio-companion bug-report assistant.",
			`Reply in language: ${language}. Ask one short question at a time.`,
			"Collect what happened, steps, expected result, and actual result.",
			`Surface is ${this.surface}. Board is ${this.board || "none"}. Do not ask for secrets.`,
			"When you have enough, call complete_report, then thank the user and stop.",
			"Use ov_find, ov_grep, and ov_read for project facts. Activate gpio-companion-lookup first.",
			"If a lookup says it is unavailable, say you cannot check the project. Do not invent facts.",
			"Never say the report was sent unless complete_report succeeded.",
		].join(" ");
	}

	private async load(): Promise<StoredChat> {
		const stored = await this.ctx.storage.get<StoredChat>(CHAT_KEY);
		if (stored?.v !== 1 || !Array.isArray(stored?.messages)) {
			return emptyChat();
		}
		return stored;
	}

	private async save(chat: StoredChat): Promise<void> {
		await this.ctx.storage.put(CHAT_KEY, chat);
	}

	private view(chat: StoredChat, live?: SupportChatLive): SupportChatState {
		const active =
			live && (live.draft.length > 0 || live.tools.length > 0) ? live : undefined;
		return {
			status: chat.summary
				? "completed"
				: chat.messages.length || active
					? "chatting"
					: "idle",
			messages: chat.messages,
			...(chat.summary ? { summary: chat.summary } : {}),
			...(active ? { live: active } : {}),
		};
	}

	private resetLive(): void {
		this.live = { draft: "", tools: [] };
	}

	private async readLive(): Promise<SupportChatLive | undefined> {
		const stored = await this.ctx.storage.get<SupportChatLive>(LIVE_KEY);
		if (!stored?.draft && !stored?.tools?.length) {
			return undefined;
		}
		return stored;
	}

	private async persistLive(): Promise<void> {
		if (!this.live.draft && this.live.tools.length === 0) {
			await this.ctx.storage.delete(LIVE_KEY);
			return;
		}
		await this.ctx.storage.put(LIVE_KEY, this.live);
	}

	private async clearLive(): Promise<void> {
		this.resetLive();
		await this.ctx.storage.delete(LIVE_KEY);
	}

	private upsertTool(
		id: string,
		name: string,
		text: string | undefined,
		status: SupportChatLiveTool["status"],
	): void {
		const current = this.live.tools.find((tool) => tool.id === id);
		if (!current) {
			this.live.tools.push({ id, name, text: text ?? "", status });
			return;
		}
		current.name = name || current.name;
		current.status = status;
		if (text !== undefined) {
			current.text = text;
		}
	}

	private applyOutput(
		id: string,
		name: string,
		output:
			| { trimStart?: number; append?: string }
			| { set: string }
			| undefined,
	): void {
		const current = this.live.tools.find((tool) => tool.id === id);
		if (!current) {
			const text =
				output && "set" in output ? output.set : (output?.append ?? "");
			this.upsertTool(id, name, text, "running");
			return;
		}
		if (!output) {
			return;
		}
		if ("set" in output) {
			current.text = output.set;
			return;
		}
		if (output.trimStart) {
			current.text = current.text.slice(output.trimStart);
		}
		if (output.append) {
			current.text += output.append;
		}
	}

	private draftFromMessage(message: {
		content?: { type?: string; text?: string }[];
	}): string {
		return (message.content ?? [])
			.filter((block) => block.type === "text" && block.text)
			.map((block) => block.text ?? "")
			.join("");
	}

	private applyLive(raw: unknown): void {
		if (!raw || typeof raw !== "object") {
			return;
		}
		const event = raw as {
			type?: string;
			changes?: readonly {
				type?: string;
				delta?: string;
				block?: { text?: string };
				message?: { content?: { type?: string; text?: string }[] };
			}[];
			toolCallId?: string;
			toolName?: string;
			output?: { trimStart?: number; append?: string } | { set: string };
			generation?: {
				message?: { content?: { type?: string; text?: string }[] };
			};
			tools?: readonly {
				callId: string;
				name: string;
				status: string;
				output?: string;
			}[];
		};
		if (event.type === "snapshot") {
			const text = event.generation?.message
				? this.draftFromMessage(event.generation.message)
				: "";
			if (text) {
				this.live.draft = text;
			}
			for (const slot of event.tools ?? []) {
				this.upsertTool(
					slot.callId,
					slot.name,
					slot.output,
					slot.status === "done" ? "done" : "running",
				);
			}
			return;
		}
		if (event.type === "message_update") {
			for (const change of event.changes ?? []) {
				if (change.type === "text_delta" && change.delta) {
					this.live.draft += change.delta;
				}
				if (
					change.type === "text_start" &&
					change.block?.text &&
					!this.live.draft
				) {
					this.live.draft = change.block.text;
				}
				if (change.type === "message" && change.message) {
					const text = this.draftFromMessage(change.message);
					if (text) {
						this.live.draft = text;
					}
				}
			}
			return;
		}
		if (event.type === "tool_execution_start" && event.toolCallId) {
			this.upsertTool(
				event.toolCallId,
				event.toolName || "tool",
				undefined,
				"running",
			);
			return;
		}
		if (event.type === "tool_execution_update" && event.toolCallId) {
			this.applyOutput(
				event.toolCallId,
				event.toolName || "tool",
				event.output,
			);
			return;
		}
		if (event.type === "tool_execution_end" && event.toolCallId) {
			this.upsertTool(
				event.toolCallId,
				event.toolName || "tool",
				undefined,
				"done",
			);
		}
	}

	private async dispatch(
		input: AgentDispatch,
	): Promise<{ sent: true; reportId: string }> {
		const kind = input.kind === "enhancement" ? "enhancement" : "bug";
		const surface = supportSurface(input.surface ?? "web");
		const summary = parseSupportSummary(
			{
				title: input.title,
				description: input.description,
				steps: input.steps,
				expected: input.expected,
				actual: input.actual,
				severity: input.severity,
			},
			{
				surface,
				board: typeof input.board === "string" ? input.board.slice(0, 120) : "",
			},
		);
		const filed = {
			...summary,
			title: `${kind}: ${summary.title}`.slice(0, 120),
		};
		const notes = [
			...(input.console ?? []).slice(0, 20).map((line) => ({
				id: crypto.randomUUID(),
				role: "tool" as const,
				tool: "console",
				text: `${line.level ?? "error"}: ${line.text ?? ""}`.slice(0, 240),
			})),
			...(input.network ?? []).slice(0, 20).map((line) => ({
				id: crypto.randomUUID(),
				role: "tool" as const,
				tool: "network",
				text: `${line.method ?? "GET"} ${line.path ?? ""} ${line.status ?? 0}`.slice(
					0,
					240,
				),
			})),
		];
		this.userId = input.userId?.trim() || "agent";
		this.surface = surface;
		this.board = summary.board;
		this.mail = input.mail ?? null;
		try {
			const reportId = await this.sendReport(filed, notes);
			return { sent: true, reportId };
		} finally {
			this.mail = null;
		}
	}

	private async snapshot(): Promise<SupportChatState> {
		return this.view(await this.load(), await this.readLive());
	}

	private async cancelChat(): Promise<SupportChatState & { refund: boolean }> {
		const current = await this.load();
		const refund = !current.summary && !current.sentId;
		this.generation += 1;
		try {
			await this.harness.session().reset("cancelled");
		} catch {
			undefined;
		}
		const chat = emptyChat();
		await this.save(chat);
		await this.clearLive();
		return { ...this.view(chat), refund };
	}

	private cancelled(generation: number): boolean {
		return generation !== this.generation;
	}

	private async streamPrompt(
		prompt: string,
		generation: number,
	): Promise<{ text?: string }> {
		const receipt = await this.harness.submit(prompt);
		const stream = await this.harness.session().events().catch(() => null);
		if (stream) {
			this.applyLive(stream.snapshot);
			await this.persistLive();
			stream.start(async (events) => {
				if (this.cancelled(generation)) {
					return;
				}
				for (const event of events) {
					this.applyLive(event);
				}
				await this.persistLive();
			});
		}
		try {
			return await this.harness.wait(receipt.operationId);
		} finally {
			if (stream) {
				await stream.stop().catch(() => undefined);
			}
			await this.clearLive();
		}
	}

	private async handleTurn(turn: SupportChatTurn): Promise<SupportChatState> {
		if (!this.env.AI) {
			throw new Error("workers ai is not bound");
		}
		const generation = this.generation;
		this.turnGeneration = generation;
		const surface = supportSurface(turn.surface);
		this.locale = supportLocale(turn.locale);
		this.surface = surface;
		this.userId = turn.userId?.trim() || this.ctx.id.toString();
		this.board = boardLabel(turn);
		this.mail = turn.mail ?? null;
		this.notes = [];
		try {
			let chat = await this.load();
			if (turn.restart && (chat.summary || chat.messages.length)) {
				await this.harness.session().reset("new bug report");
				chat = emptyChat();
				await this.save(chat);
			}
			if (chat.summary) {
				return this.view(chat);
			}
			const text = supportText(turn.text);
			if (!text) {
				throw new Error("describe the bug");
			}
			const count = userMessageCount(chat.messages);
			if (count >= SUPPORT_CHAT_MESSAGE_CAP) {
				await this.forceComplete(chat);
				return this.view(await this.load());
			}
			const prompt =
				count >= SUPPORT_CHAT_MESSAGE_CAP - 2
					? `${text}\n\nYou are near the message cap. Call complete_report now with what you know. Mark incomplete if steps are missing.`
					: text;
			chat.messages.push({ id: crypto.randomUUID(), role: "user", text });
			await this.save(chat);
			const result = await this.streamPrompt(prompt, generation);
			if (this.cancelled(generation)) {
				return this.snapshot();
			}
			chat = await this.load();
			chat.messages.push(...this.notes);
			const answer = result.text?.trim();
			if (answer) {
				chat.messages.push({
					id: crypto.randomUUID(),
					role: "agent",
					text: answer,
				});
			}
			await this.save(chat);
			if (
				!chat.summary &&
				userMessageCount(chat.messages) >= SUPPORT_CHAT_MESSAGE_CAP
			) {
				await this.forceComplete(chat);
			}
			await this.clearLive();
			return this.view(await this.load());
		} finally {
			this.mail = null;
			this.notes = [];
			await this.clearLive();
		}
	}

	private async forceComplete(chat: StoredChat): Promise<void> {
		const summary = partialSummary(chat.messages, {
			surface: this.surface,
			board: this.board,
		});
		await this.sendReport(summary, chat.messages);
		const next = await this.load();
		next.summary = summary;
		next.messages.push({
			id: crypto.randomUUID(),
			role: "agent",
			text:
				this.locale === "fr"
					? "Merci pour le rapport de bug. Le support l’a reçu."
					: "Thanks for the bug report. Support has it.",
		});
		await this.save(next);
	}

	private async sendReport(
		summary: SupportChatSummary,
		messages: SupportChatMessage[],
	): Promise<string> {
		if (this.turnGeneration !== this.generation) {
			throw new Error("bug report was cancelled");
		}
		const mail = this.mail;
		if (!mail?.accountId || !mail.token) {
			throw new Error("support email is not configured");
		}
		const id = supportReportId(summary);
		const chat = await this.load();
		if (chat.sentId === id) {
			return id;
		}
		const message = supportReportMail(summary, messages, {
			userId: this.userId,
			...(mail.replyTo ? { replyTo: mail.replyTo } : {}),
			...(mail.from ? { from: mail.from } : {}),
		});
		await deliverSupportEmail(mail.accountId, mail.token, message);
		await saveSupportReport(this.env.DASHBOARD_DB, {
			reportId: id,
			userId: this.userId,
			createdAt: new Date().toISOString(),
			surface: summary.surface,
			board: summary.board,
			subject: message.subject,
			bodyText: message.text,
			bodyHtml: message.html,
			summaryJson: JSON.stringify(summary),
		});
		const next = await this.load();
		next.sentId = id;
		next.summary = summary;
		await this.save(next);
		return id;
	}

	private async lookup(
		tool: string,
		call: Parameters<typeof queryOpenViking>[2],
	) {
		let text = "project lookup is unavailable";
		try {
			text = await queryOpenViking(
				this.env.OPENVIKING,
				this.env.OPENVIKING_API_KEY,
				call,
			);
		} catch (caught) {
			text = caught instanceof Error ? caught.message : text;
		}
		this.notes.push({ id: crypto.randomUUID(), role: "tool", tool, text });
		return textResult(text, text.startsWith("project lookup"));
	}

	private findTool() {
		const agent = this;
		return {
			name: "ov_find",
			description: `Search ${"viking://resources/gpio-companion"} for project facts.`,
			parameters: Type.Object({ query: Type.String() }),
			replay: "safe" as const,
			async execute(args: { query: string }) {
				return agent.lookup("ov_find", { op: "find", query: args.query });
			},
		};
	}

	private grepTool() {
		const agent = this;
		return {
			name: "ov_grep",
			description:
				"Search project text under viking://resources/gpio-companion.",
			parameters: Type.Object({
				pattern: Type.String(),
				uri: Type.Optional(Type.String()),
			}),
			replay: "safe" as const,
			async execute(args: { pattern: string; uri?: string }) {
				return agent.lookup("ov_grep", {
					op: "grep",
					pattern: args.pattern,
					uri: args.uri,
				});
			},
		};
	}

	private readTool() {
		const agent = this;
		return {
			name: "ov_read",
			description: "Read one file under viking://resources/gpio-companion.",
			parameters: Type.Object({ uri: Type.String() }),
			replay: "safe" as const,
			async execute(args: { uri: string }) {
				return agent.lookup("ov_read", { op: "read", uri: args.uri });
			},
		};
	}

	private completeTool() {
		const agent = this;
		return {
			name: "complete_report",
			description:
				"Send the bug report once you know what happened, what was expected, and what actually happened.",
			parameters: Type.Object({
				title: Type.String(),
				description: Type.String(),
				steps: Type.Optional(Type.Array(Type.String())),
				expected: Type.Optional(Type.String()),
				actual: Type.Optional(Type.String()),
				severity: Type.Optional(
					Type.Union([
						Type.Literal("low"),
						Type.Literal("medium"),
						Type.Literal("high"),
					]),
				),
				incomplete: Type.Optional(Type.Boolean()),
			}),
			replay: "unsafe" as const,
			async execute(args: {
				title: string;
				description: string;
				steps?: string[];
				expected?: string;
				actual?: string;
				severity?: "low" | "medium" | "high";
				incomplete?: boolean;
			}) {
				try {
					const summary = parseSupportSummary(args, {
						surface: agent.surface,
						board: agent.board,
					});
					const thanks =
						agent.locale === "fr"
							? "Merci pour le rapport de bug. Le support l’a reçu."
							: "Thanks for the bug report. Support has it.";
					agent.notes.push({
						id: crypto.randomUUID(),
						role: "tool",
						tool: "complete_report",
						text: thanks,
					});
					const chat = await agent.load();
					await agent.sendReport(summary, [...chat.messages, ...agent.notes]);
					return textResult(thanks);
				} catch (caught) {
					const message =
						caught instanceof Error ? caught.message : "request failed";
					return textResult(message, true);
				}
			},
		};
	}
}

export default {
	async fetch(): Promise<Response> {
		return new Response("not found", { status: 404 });
	},
};
