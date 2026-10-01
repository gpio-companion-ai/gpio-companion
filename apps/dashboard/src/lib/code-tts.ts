import {
	CODE_TTS_MAX_CHARS,
	CODE_TTS_MODEL,
	CODE_TTS_XAI_DEFAULT_VOICE,
	CODE_TTS_XAI_ENDPOINT,
	codeSttLanguage,
	codeTtsMicros,
	codeTtsXaiMicros,
	codeVoiceSettings,
	decodeBase64,
	encodeBase64,
	parseMarkup,
} from "gpio-companion";
import { consumeMicrodollars, creditsBalance } from "./credits.ts";
import { getVoiceSettings } from "./voice-settings.ts";

type TtsEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
	XAI_API_KEY?: string;
};

export async function speakCodeText(
	env: TtsEnv,
	userId: string,
	input: unknown,
): Promise<{ audio: string }> {
	const record =
		input && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	const text = typeof record.text === "string" ? record.text.trim() : "";
	if (!text) {
		throw new Error("text is required");
	}
	if (text.length > CODE_TTS_MAX_CHARS) {
		throw new Error("text is too large");
	}
	const settings = await getVoiceSettings(env.DYNAMIC_PAGE_KV, userId);
	const markup = parseMarkup(env.GPIO_AI_MARKUP);
	const charge =
		settings.provider === "xai"
			? codeTtsXaiMicros(text.length, markup)
			: codeTtsMicros(text.length, markup);
	const balance = await creditsBalance(env.DYNAMIC_PAGE_KV, userId);
	if (balance <= 0 || balance < charge) {
		throw new Error("credits empty");
	}
	const locale = typeof record.locale === "string" ? record.locale : "en";
	const audio =
		settings.provider === "xai"
			? await speakXai(env, text, settings.voice, locale)
			: await speakWorkersAi(env, text, locale);
	if (!audio) {
		throw new Error("speech failed");
	}
	await consumeMicrodollars(env.DYNAMIC_PAGE_KV, userId, charge);
	return { audio };
}

async function speakWorkersAi(
	env: TtsEnv,
	text: string,
	locale: string,
): Promise<string> {
	if (!env.AI) {
		throw new Error("workers ai is not bound");
	}
	const result = (await env.AI.run(CODE_TTS_MODEL, {
		prompt: text,
		lang: codeSttLanguage(locale),
	})) as unknown;
	return audioBase64(result);
}

async function speakXai(
	env: TtsEnv,
	text: string,
	voice: string,
	locale: string,
): Promise<string> {
	const key = env.XAI_API_KEY;
	if (!key) {
		throw new Error("voice provider is not configured");
	}
	const response = await fetch(CODE_TTS_XAI_ENDPOINT, {
		method: "POST",
		headers: {
			authorization: `Bearer ${key}`,
			"content-type": "application/json",
		},
		body: JSON.stringify({
			text,
			voice_id: voice || CODE_TTS_XAI_DEFAULT_VOICE,
			language: codeSttLanguage(locale),
		}),
	});
	if (!response.ok) {
		throw new Error("voice service is unavailable");
	}
	return encodeBase64(new Uint8Array(await response.arrayBuffer()));
}

function audioBase64(result: unknown): string {
	if (typeof result === "string" && result.trim()) {
		return isBase64(result) ? result.trim() : encodeBase64(bytesOf(result));
	}
	if (result instanceof ArrayBuffer) {
		return encodeBase64(new Uint8Array(result));
	}
	if (result instanceof Uint8Array) {
		return encodeBase64(result);
	}
	if (result && typeof result === "object") {
		const audio = (result as { audio?: unknown }).audio;
		if (typeof audio === "string" && audio.trim()) {
			return audio.trim();
		}
	}
	return "";
}

function bytesOf(text: string): Uint8Array {
	return new TextEncoder().encode(text);
}

function isBase64(value: string): boolean {
	try {
		return decodeBase64(value).byteLength > 0;
	} catch {
		return false;
	}
}
