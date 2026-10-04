import { DEFAULT_AI_MARKUP, usdToMicros } from "./ai-pricing.ts";
import {
	publicKeyPemFromPrivateKey,
	signEd25519Message,
	verifyEd25519Message,
} from "./device-auth.ts";

export const VOICE_PATH = "/api/voice/live";
export const VOICE_TOKEN_PREFIX = "gpiovoice.v1.";
export const VOICE_TOKEN_TTL_MS = 60 * 60 * 1000;
export const VOICE_BILL_MS = 15_000;
export const VOICE_S2S_USD_PER_MIN = 0.08;
export const VOICE_SAMPLE_RATE = 16_000;
export const VOICE_MODEL = "grok-voice-latest";
export const VOICE_VOICE_ID = "eve";
export const VOICE_ID_STORAGE_KEY = "gpio-companion-voice-id";
export const WAKE_PHRASE = "hey companion";
export const WAKE_PHRASE_LABEL = "Hey Companion";
export const VOICE_MIC_STORAGE_KEY = "gpio-companion-voice-mic";

export type VoiceSpeaker = {
	id: string;
	name: string;
};

export const VOICE_SPEAKERS: readonly VoiceSpeaker[] = [
	{ id: "eve", name: "Eve" },
	{ id: "altair", name: "Altair" },
	{ id: "ara", name: "Ara" },
	{ id: "rex", name: "Rex" },
	{ id: "sal", name: "Sal" },
	{ id: "leo", name: "Leo" },
];

export type VoiceMicMode = "hold" | "always" | "wake";

export type VoiceTicketClaims = {
	uuid: string;
	userId: string;
	exp: number;
};

export type VoiceTicket = {
	token: string;
	expiresAt: string;
	exp: number;
	wsUrl: string;
};

export type VoiceClientType = "hello" | "start" | "stop" | "ping";

export type VoiceServerType =
	| "transcript"
	| "heard"
	| "status"
	| "error"
	| "agent";

export type VoiceClientMessage = {
	v: 1;
	type: VoiceClientType;
	locale?: string;
	mode?: VoiceMicMode;
	repo?: string;
	owner?: string;
	voice?: string;
};

export type VoiceServerMessage = {
	v: 1;
	type: VoiceServerType;
	text?: string;
	state?: "idle" | "listening" | "talking" | "working";
	billed?: boolean;
};

export type VoiceGrokFunctionTool = {
	type: "function";
	name: string;
	description: string;
	parameters: {
		type: "object";
		properties: Record<string, unknown>;
		required: string[];
	};
};

const MIC_MODES = new Set<VoiceMicMode>(["hold", "always", "wake"]);
const CLIENT_TYPES = new Set<VoiceClientType>([
	"hello",
	"start",
	"stop",
	"ping",
]);
const SERVER_TYPES = new Set<VoiceServerType>([
	"transcript",
	"heard",
	"status",
	"error",
	"agent",
]);

export function isVoiceMicMode(value: unknown): value is VoiceMicMode {
	return typeof value === "string" && MIC_MODES.has(value as VoiceMicMode);
}

export function parseVoiceMicMode(value: unknown): VoiceMicMode {
	return isVoiceMicMode(value) ? value : "hold";
}

export function parseVoiceId(value: unknown): string {
	if (typeof value !== "string") {
		return VOICE_VOICE_ID;
	}
	const id = value.trim().toLowerCase();
	return VOICE_SPEAKERS.some((speaker) => speaker.id === id)
		? id
		: VOICE_VOICE_ID;
}

export function isVoiceAccessToken(token: string): boolean {
	return token.trim().startsWith(VOICE_TOKEN_PREFIX);
}

export function voiceOrigin(origin?: string): string {
	return (origin || "https://gpio-companion.com").replace(/\/+$/, "");
}

export function voiceWsUrl(
	origin: string,
	uuid: string,
	ticket?: string,
): string {
	const url = new URL(`${voiceOrigin(origin)}${VOICE_PATH}`);
	if (url.protocol === "https:") {
		url.protocol = "wss:";
	} else if (url.protocol === "http:") {
		url.protocol = "ws:";
	}
	url.searchParams.set("uuid", uuid.trim());
	if (ticket?.trim()) {
		url.searchParams.set("ticket", ticket.trim());
	}
	return url.toString();
}

export function voiceSessionMicros(
	durationMs: number,
	markup = DEFAULT_AI_MARKUP,
): number {
	const minutes = Math.max(0, durationMs) / 60_000;
	return usdToMicros(minutes * VOICE_S2S_USD_PER_MIN * markup);
}

export function foldWakeText(text: string): string {
	return text
		.toLowerCase()
		.normalize("NFD")
		.replace(/[\u0300-\u036f]/g, "")
		.replace(/[^a-z0-9\s]/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

export function matchesWakePhrase(text: string): boolean {
	const normalized = foldWakeText(text);
	if (!normalized) {
		return false;
	}
	if (
		normalized.includes(WAKE_PHRASE) ||
		normalized.includes("hey compagnon") ||
		normalized.includes("hi companion") ||
		normalized.includes("ok companion") ||
		normalized.includes("dis companion")
	) {
		return true;
	}
	const words = normalized.split(" ");
	let hey = -1;
	let companion = -1;
	for (let i = 0; i < words.length; i += 1) {
		const word = words[i] ?? "";
		if (
			hey < 0 &&
			(word === "hey" ||
				word === "he" ||
				word === "hi" ||
				word === "ok" ||
				word === "dis")
		) {
			hey = i;
		}
		if (word.startsWith("companion") || word.startsWith("compagnon")) {
			companion = i;
		}
	}
	return hey >= 0 && companion > hey;
}

export function parseVoiceClientMessage(
	input: unknown,
): VoiceClientMessage | null {
	const record = asRecord(input);
	if (record?.v !== 1 || !CLIENT_TYPES.has(record.type as VoiceClientType)) {
		return null;
	}
	const message: VoiceClientMessage = {
		v: 1,
		type: record.type as VoiceClientType,
	};
	if (typeof record.locale === "string" && record.locale.trim()) {
		message.locale = record.locale.trim();
	}
	if (isVoiceMicMode(record.mode)) {
		message.mode = record.mode;
	}
	if (typeof record.repo === "string" && record.repo.trim()) {
		message.repo = record.repo.trim();
	}
	if (typeof record.owner === "string" && record.owner.trim()) {
		message.owner = record.owner.trim();
	}
	if (typeof record.voice === "string" && record.voice.trim()) {
		message.voice = parseVoiceId(record.voice);
	}
	return message;
}

export function parseVoiceServerMessage(
	input: unknown,
): VoiceServerMessage | null {
	const record = asRecord(input);
	if (record?.v !== 1 || !SERVER_TYPES.has(record.type as VoiceServerType)) {
		return null;
	}
	const message: VoiceServerMessage = {
		v: 1,
		type: record.type as VoiceServerType,
	};
	if (typeof record.text === "string") {
		message.text = record.text;
	}
	if (
		record.state === "idle" ||
		record.state === "listening" ||
		record.state === "talking" ||
		record.state === "working"
	) {
		message.state = record.state;
	}
	if (typeof record.billed === "boolean") {
		message.billed = record.billed;
	}
	return message;
}

export function encodeVoiceMessage(
	message: VoiceClientMessage | VoiceServerMessage,
): string {
	return JSON.stringify(message);
}

export const VOICE_GROK_TOOLS: VoiceGrokFunctionTool[] = [
	{
		type: "function",
		name: "gpio_snapshot",
		description:
			"Read live GPIO pin directions and values on the companion header.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "arduino_proxy_status",
		description: "Check whether a USB Arduino Firmata proxy is connected.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "list_sketches",
		description: "List host and USB Arduino sketches on the selected project.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "run_sketch",
		description: "Compile and run an existing host sketch on the board.",
		parameters: {
			type: "object",
			properties: {
				dir: {
					type: "string",
					description: "Absolute sketch directory from list_sketches",
				},
			},
			required: ["dir"],
		},
	},
	{
		type: "function",
		name: "stop_sketch",
		description: "Stop the running host sketch.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "verify_circuit",
		description:
			"Pulse jumpers from breadboard/diagram.json and report continuity.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "flash_proxy",
		description: "Flash bundled Firmata slave firmware to the USB Arduino.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "flash_arduino",
		description: "Compile and upload a USB Arduino sketch directory.",
		parameters: {
			type: "object",
			properties: {
				dir: { type: "string", description: "Absolute firmware directory" },
				fqbn: { type: "string", description: "Arduino FQBN" },
			},
			required: ["dir"],
		},
	},
	{
		type: "function",
		name: "save_project",
		description: "Commit and push the current project checkout from the board.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "ask_companion",
		description:
			"Ask the on-device OpenCode agent to add a feature or write a C sketch. Use this instead of lasting GPIO writes.",
		parameters: {
			type: "object",
			properties: {
				prompt: {
					type: "string",
					description: "What the companion agent should do",
				},
			},
			required: ["prompt"],
		},
	},
	{
		type: "function",
		name: "agent_status",
		description: "Read the on-device OpenCode job log.",
		parameters: { type: "object", properties: {}, required: [] },
	},
	{
		type: "function",
		name: "stop_agent",
		description: "Stop the on-device OpenCode job.",
		parameters: { type: "object", properties: {}, required: [] },
	},
];

export function voiceGrokInstructions(locale: string, repo: string): string {
	const language = locale.toLowerCase().startsWith("fr")
		? "Speak French (vous)."
		: "Speak English.";
	const project = repo.trim() ? `The open project is ${repo.trim()}.` : "";
	return [
		"You are the gpio-companion bench copilot.",
		"The user is wiring a breadboard and talking with their hands busy.",
		"Keep replies short. Confirm actions out loud.",
		language,
		project,
		"Use tools for the physical board.",
		"For new sketches, blinks, PWM, tone, or features call ask_companion.",
		"Never lastingly drive pins yourself. Do not unpair, change WiFi, or spend credits.",
	]
		.filter(Boolean)
		.join(" ");
}

export function voiceKeyterms(): string[] {
	return [
		"gpio-companion",
		"Arduino",
		"Orange Pi",
		"Raspberry Pi",
		"Firmata",
		"breadboard",
		"tscircuit",
		"GPIO",
	];
}

export async function signVoiceTicket(options: {
	privateKeyPem: string;
	uuid: string;
	userId: string;
	origin?: string;
	now?: number;
	ttlMs?: number;
}): Promise<VoiceTicket> {
	const uuid = options.uuid.trim();
	const userId = options.userId.trim();
	if (!uuid) {
		throw new Error("uuid is required");
	}
	if (!userId) {
		throw new Error("userId is required");
	}
	const now = options.now ?? Date.now();
	const ttlMs = options.ttlMs ?? VOICE_TOKEN_TTL_MS;
	const exp = now + ttlMs;
	const payload = JSON.stringify({
		uuid,
		userId,
		exp,
	} satisfies VoiceTicketClaims);
	const signature = await signEd25519Message(
		options.privateKeyPem,
		new TextEncoder().encode(payload),
	);
	const token = `${VOICE_TOKEN_PREFIX}${bytesToBase64Url(new TextEncoder().encode(payload))}.${bytesToBase64Url(signature)}`;
	return {
		token,
		expiresAt: new Date(exp).toISOString(),
		exp,
		wsUrl: voiceWsUrl(voiceOrigin(options.origin), uuid, token),
	};
}

export async function verifyVoiceTicket(options: {
	token: string;
	publicKeyPem?: string;
	privateKeyPem?: string;
	now?: number;
}): Promise<VoiceTicketClaims> {
	const token = options.token.trim();
	if (!isVoiceAccessToken(token)) {
		throw new Error("invalid voice token");
	}
	const rest = token.slice(VOICE_TOKEN_PREFIX.length);
	const dot = rest.indexOf(".");
	if (dot <= 0 || dot === rest.length - 1) {
		throw new Error("invalid voice token");
	}
	let payloadBytes: Uint8Array;
	let signature: Uint8Array;
	try {
		payloadBytes = base64UrlToBytes(rest.slice(0, dot));
		signature = base64UrlToBytes(rest.slice(dot + 1));
	} catch {
		throw new Error("invalid voice token");
	}
	const publicKeyPem =
		options.publicKeyPem?.trim() ||
		(options.privateKeyPem
			? await publicKeyPemFromPrivateKey(options.privateKeyPem)
			: "");
	if (!publicKeyPem) {
		throw new Error("voice token key is not set");
	}
	const ok = await verifyEd25519Message(publicKeyPem, payloadBytes, signature);
	if (!ok) {
		throw new Error("invalid voice token");
	}
	let claims: VoiceTicketClaims;
	try {
		const parsed = JSON.parse(new TextDecoder().decode(payloadBytes)) as {
			uuid?: unknown;
			userId?: unknown;
			exp?: unknown;
		};
		const uuid = typeof parsed.uuid === "string" ? parsed.uuid.trim() : "";
		const userId =
			typeof parsed.userId === "string" ? parsed.userId.trim() : "";
		const exp = Number(parsed.exp);
		if (!uuid || !userId || !Number.isFinite(exp)) {
			throw new Error("invalid voice token");
		}
		claims = { uuid, userId, exp };
	} catch {
		throw new Error("invalid voice token");
	}
	const now = options.now ?? Date.now();
	if (now >= claims.exp) {
		throw new Error("expired voice token");
	}
	return claims;
}

function asRecord(input: unknown): Record<string, unknown> | null {
	let value = input;
	if (typeof input === "string") {
		try {
			value = JSON.parse(input) as unknown;
		} catch {
			return null;
		}
	}
	if (!value || typeof value !== "object") {
		return null;
	}
	return value as Record<string, unknown>;
}

function bytesToBase64Url(bytes: Uint8Array): string {
	let binary = "";
	for (const byte of bytes) {
		binary += String.fromCharCode(byte);
	}
	return btoa(binary)
		.replaceAll("+", "-")
		.replaceAll("/", "_")
		.replaceAll("=", "");
}

function base64UrlToBytes(value: string): Uint8Array {
	const padded = value.replaceAll("-", "+").replaceAll("_", "/");
	const pad =
		padded.length % 4 === 0 ? "" : "=".repeat(4 - (padded.length % 4));
	const binary = atob(padded + pad);
	const bytes = new Uint8Array(binary.length);
	for (let i = 0; i < binary.length; i += 1) {
		bytes[i] = binary.charCodeAt(i);
	}
	return bytes;
}
