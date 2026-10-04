import { DurableObject } from "cloudflare:workers";
import {
	parseMarkup,
	parseVoiceClientMessage,
	parseVoiceId,
	VOICE_BILL_MS,
	VOICE_GROK_TOOLS,
	VOICE_MODEL,
	VOICE_SAMPLE_RATE,
	VOICE_VOICE_ID,
	type VoiceMicMode,
	voiceGrokInstructions,
	voiceKeyterms,
	voiceSessionMicros,
} from "gpio-companion";
import { consumeMicrodollars, creditsBalance } from "./credits.ts";
import { runVoiceTool } from "./tools.ts";

export type Env = {
	VOICE_HUB: DurableObjectNamespace<VoiceHub>;
	DYNAMIC_PAGE_KV: KVNamespace;
	XAI_API_KEY?: string;
	GPIO_COMPANION_DEVICE_PRIVATE_KEY?: string;
	GPIO_COMPANION_DEVICE_KEY_ID?: string;
	GPIO_AI_MARKUP?: string;
};

type Session = {
	userId: string;
	uuid: string;
	deviceUrl: string;
	repo: string;
	owner: string;
	locale: string;
	mode: VoiceMicMode;
	voice: string;
};

export class VoiceHub extends DurableObject<Env> {
	private client: WebSocket | null = null;
	private xai: WebSocket | null = null;
	private session: Session | null = null;
	private startedAt = 0;
	private billedMs = 0;
	private pendingCalls = 0;

	override async fetch(request: Request): Promise<Response> {
		const url = new URL(request.url);
		if (request.method === "POST" && url.searchParams.get("op") === "stt") {
			return this.transcribe(request);
		}
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected websocket", { status: 426 });
		}
		const userId = url.searchParams.get("userId")?.trim() ?? "";
		const uuid = url.searchParams.get("uuid")?.trim() ?? "";
		const deviceUrl = url.searchParams.get("deviceUrl")?.trim() ?? "";
		if (!userId || !uuid || !deviceUrl) {
			return new Response("invalid voice socket", { status: 400 });
		}
		const balance = await creditsBalance(this.env.DYNAMIC_PAGE_KV, userId);
		if (balance <= 0) {
			return new Response("credits empty", { status: 402 });
		}
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		if (!client || !server) {
			return new Response("websocket pair failed", { status: 500 });
		}
		if (this.client) {
			try {
				this.client.close(4000, "replaced");
			} catch {
				undefined;
			}
		}
		server.accept();
		this.client = server;
		this.session = {
			userId,
			uuid,
			deviceUrl,
			repo: url.searchParams.get("repo")?.trim() ?? "",
			owner: url.searchParams.get("owner")?.trim() ?? "",
			locale: url.searchParams.get("locale")?.trim() || "en",
			mode: "hold",
			voice: parseVoiceId(url.searchParams.get("voice")),
		};
		server.addEventListener("message", (event) => {
			void this.onClient(event.data);
		});
		server.addEventListener("close", () => {
			void this.onClientClose(server);
		});
		this.send({ v: 1, type: "status", state: "idle", billed: false });
		return new Response(null, { status: 101, webSocket: client });
	}

	override async alarm(): Promise<void> {
		if (!this.xai || !this.session || !this.startedAt) {
			return;
		}
		await this.bill(false);
		if (this.xai) {
			await this.ctx.storage.setAlarm(Date.now() + VOICE_BILL_MS);
		}
	}

	private async onClient(data: string | ArrayBuffer): Promise<void> {
		if (typeof data !== "string") {
			this.forwardAudio(data);
			return;
		}
		const message = parseVoiceClientMessage(data);
		if (!message || !this.session) {
			return;
		}
		if (message.repo) {
			this.session.repo = message.repo;
		}
		if (message.owner) {
			this.session.owner = message.owner;
		}
		if (message.locale) {
			this.session.locale = message.locale;
		}
		if (message.mode) {
			this.session.mode = message.mode;
		}
		if (message.voice) {
			this.session.voice = parseVoiceId(message.voice);
			if (this.xai) {
				this.sendSessionUpdate();
			}
		}
		if (message.type === "start") {
			await this.openXai();
			return;
		}
		if (message.type === "stop") {
			await this.closeXai();
		}
	}

	private async onClientClose(socket: WebSocket): Promise<void> {
		if (this.client !== socket) {
			return;
		}
		this.client = null;
		await this.closeXai();
	}

	private async openXai(): Promise<void> {
		if (this.xai || !this.session) {
			return;
		}
		const key = this.env.XAI_API_KEY?.trim() ?? "";
		if (!key) {
			this.send({ v: 1, type: "error", text: "voice is not configured" });
			return;
		}
		const balance = await creditsBalance(
			this.env.DYNAMIC_PAGE_KV,
			this.session.userId,
		);
		if (balance <= 0) {
			this.send({ v: 1, type: "error", text: "credits empty" });
			return;
		}
		const response = await fetch(
			`https://api.x.ai/v1/realtime?model=${VOICE_MODEL}`,
			{
				headers: {
					Upgrade: "websocket",
					Connection: "Upgrade",
					Authorization: `Bearer ${key}`,
				},
			},
		);
		const socket = response.webSocket;
		if (!socket) {
			this.send({ v: 1, type: "error", text: "voice connect failed" });
			return;
		}
		socket.accept();
		this.xai = socket;
		this.startedAt = Date.now();
		this.billedMs = 0;
		socket.addEventListener("message", (event) => {
			void this.onXai(event.data);
		});
		socket.addEventListener("close", () => {
			void this.onXaiClose(socket);
		});
		this.sendSessionUpdate();
		this.send({ v: 1, type: "status", state: "talking", billed: true });
		await this.ctx.storage.setAlarm(Date.now() + VOICE_BILL_MS);
	}

	private async closeXai(): Promise<void> {
		const socket = this.xai;
		this.xai = null;
		if (socket) {
			try {
				socket.close(1000, "stop");
			} catch {
				undefined;
			}
		}
		await this.bill(true);
		this.startedAt = 0;
		this.send({ v: 1, type: "status", state: "idle", billed: false });
	}

	private async onXaiClose(socket: WebSocket): Promise<void> {
		if (this.xai !== socket) {
			return;
		}
		this.xai = null;
		await this.bill(true);
		this.startedAt = 0;
		this.send({ v: 1, type: "status", state: "idle", billed: false });
	}

	private sendSessionUpdate(): void {
		if (!this.xai || !this.session) {
			return;
		}
		const locale = this.session.locale.toLowerCase().startsWith("fr")
			? "fr"
			: "en";
		this.xai.send(
			JSON.stringify({
				type: "session.update",
				session: {
					voice: this.session.voice || VOICE_VOICE_ID,
					instructions: voiceGrokInstructions(
						this.session.locale,
						this.session.repo,
					),
					turn_detection: { type: "server_vad" },
					tools: VOICE_GROK_TOOLS,
					audio: {
						input: {
							format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE },
							transcription: {
								language_hint: locale,
								keyterms: voiceKeyterms(),
							},
						},
						output: {
							format: { type: "audio/pcm", rate: VOICE_SAMPLE_RATE },
						},
					},
					replace: {
						GPIO: "G P I O",
						tscircuit: "tee ess circuit",
					},
				},
			}),
		);
	}

	private forwardAudio(data: ArrayBuffer | ArrayBufferView): void {
		if (!this.xai) {
			return;
		}
		const bytes =
			data instanceof ArrayBuffer
				? new Uint8Array(data)
				: new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
		this.xai.send(
			JSON.stringify({
				type: "input_audio_buffer.append",
				audio: bytesToBase64(bytes),
			}),
		);
	}

	private async onXai(raw: string | ArrayBuffer): Promise<void> {
		if (typeof raw !== "string") {
			if (this.client && this.client.readyState === WebSocket.OPEN) {
				this.client.send(raw);
			}
			return;
		}
		let event: { type?: string; [key: string]: unknown };
		try {
			event = JSON.parse(raw) as { type?: string; [key: string]: unknown };
		} catch {
			return;
		}
		if (
			event.type === "response.output_audio.delta" &&
			typeof event.delta === "string"
		) {
			const bytes = base64ToBytes(event.delta);
			if (this.client && this.client.readyState === WebSocket.OPEN) {
				this.client.send(bytes);
			}
			return;
		}
		if (
			(event.type === "response.output_audio_transcript.delta" ||
				event.type === "response.output_text.delta") &&
			typeof event.delta === "string"
		) {
			this.send({ v: 1, type: "transcript", text: event.delta });
			return;
		}
		if (
			event.type === "conversation.item.input_audio_transcription.completed" &&
			typeof event.transcript === "string"
		) {
			this.send({ v: 1, type: "heard", text: event.transcript });
			return;
		}
		if (event.type === "response.function_call_arguments.done") {
			await this.handleTool({
				name: event.name,
				call_id: event.call_id,
				arguments: event.arguments,
			});
			return;
		}
		if (event.type === "error") {
			const text =
				typeof event.error === "object" &&
				event.error &&
				"message" in event.error &&
				typeof (event.error as { message: unknown }).message === "string"
					? (event.error as { message: string }).message
					: "voice error";
			this.send({ v: 1, type: "error", text });
		}
	}

	private async handleTool(event: {
		name?: unknown;
		call_id?: unknown;
		arguments?: unknown;
	}): Promise<void> {
		if (!this.xai || !this.session) {
			return;
		}
		const name = typeof event.name === "string" ? event.name : "";
		const callId = typeof event.call_id === "string" ? event.call_id : "";
		let args: Record<string, unknown> = {};
		if (typeof event.arguments === "string") {
			try {
				args = JSON.parse(event.arguments) as Record<string, unknown>;
			} catch {
				args = {};
			}
		}
		if (name === "ask_companion") {
			this.send({
				v: 1,
				type: "agent",
				state: "working",
				text: "Working on the board…",
			});
			this.forceMessage("Working on the board.");
		}
		this.pendingCalls += 1;
		let output: unknown;
		try {
			const privateKeyPem = this.env.GPIO_COMPANION_DEVICE_PRIVATE_KEY ?? "";
			if (!privateKeyPem.trim()) {
				throw new Error("device key is not set");
			}
			output = await runVoiceTool(name, args, {
				deviceUrl: this.session.deviceUrl,
				privateKeyPem,
				keyId: this.env.GPIO_COMPANION_DEVICE_KEY_ID,
				repo: this.session.repo,
				owner: this.session.owner,
			});
		} catch (caught) {
			output = {
				error: caught instanceof Error ? caught.message : "tool failed",
			};
		}
		this.pendingCalls -= 1;
		this.xai.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "function_call_output",
					call_id: callId,
					output: JSON.stringify(output),
				},
			}),
		);
		if (this.pendingCalls === 0) {
			this.xai.send(JSON.stringify({ type: "response.create" }));
		}
	}

	private forceMessage(text: string): void {
		if (!this.xai) {
			return;
		}
		this.xai.send(
			JSON.stringify({
				type: "conversation.item.create",
				item: {
					type: "force_message",
					role: "assistant",
					interruptible: true,
					content: [{ type: "output_text", text }],
				},
			}),
		);
	}

	private async bill(final: boolean): Promise<void> {
		if (!this.session || !this.startedAt) {
			return;
		}
		const elapsed = Date.now() - this.startedAt;
		const unbilled = elapsed - this.billedMs;
		if (!final && unbilled < VOICE_BILL_MS) {
			return;
		}
		const markup = parseMarkup(this.env.GPIO_AI_MARKUP);
		const debit = voiceSessionMicros(unbilled, markup);
		this.billedMs = elapsed;
		if (debit <= 0) {
			return;
		}
		const next = await consumeMicrodollars(
			this.env.DYNAMIC_PAGE_KV,
			this.session.userId,
			debit,
		);
		if (next === null) {
			this.send({ v: 1, type: "error", text: "credits empty" });
			const socket = this.xai;
			this.xai = null;
			if (socket) {
				try {
					socket.close(1000, "credits empty");
				} catch {
					undefined;
				}
			}
		}
	}

	private async transcribe(request: Request): Promise<Response> {
		const key = this.env.XAI_API_KEY?.trim() ?? "";
		if (!key) {
			return Response.json(
				{ error: "voice is not configured" },
				{ status: 503 },
			);
		}
		let form: FormData;
		try {
			form = await request.formData();
		} catch {
			return Response.json({ error: "file is required" }, { status: 400 });
		}
		const file = form.get("file") as string | File | null;
		if (!file || typeof file === "string" || !(file instanceof Blob)) {
			return Response.json({ error: "file is required" }, { status: 400 });
		}
		const body = new FormData();
		body.append("file", file, "wake.wav");
		const response = await fetch("https://api.x.ai/v1/stt", {
			method: "POST",
			headers: { Authorization: `Bearer ${key}` },
			body,
		});
		const payload = (await response.json().catch(() => null)) as {
			text?: unknown;
			error?: unknown;
		} | null;
		const text = typeof payload?.text === "string" ? payload.text : "";
		if (!response.ok) {
			const error =
				typeof payload?.error === "string" ? payload.error : "stt failed";
			return Response.json({ error }, { status: response.status });
		}
		return Response.json({ text });
	}

	private send(message: {
		v: 1;
		type: "transcript" | "heard" | "status" | "error" | "agent";
		text?: string;
		state?: "idle" | "listening" | "talking" | "working";
		billed?: boolean;
	}): void {
		if (!this.client || this.client.readyState !== WebSocket.OPEN) {
			return;
		}
		this.client.send(JSON.stringify(message));
	}
}

export default {
	fetch(): Response {
		return new Response("not found", { status: 404 });
	},
};

function bytesToBase64(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array {
	const binary = atob(value);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
