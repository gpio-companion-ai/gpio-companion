import {
	CODE_TTS_MAX_CHARS,
	CODE_TTS_MODEL,
	codeSttLanguage,
	codeTtsMicros,
	decodeBase64,
	encodeBase64,
	parseMarkup,
} from "gpio-companion";
import { consumeMicrodollars, creditsBalance } from "./credits.ts";

type TtsEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
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
	if (!env.AI) {
		throw new Error("workers ai is not bound");
	}
	const markup = parseMarkup(env.GPIO_AI_MARKUP);
	const charge = codeTtsMicros(text.length, markup);
	const balance = await creditsBalance(env.DYNAMIC_PAGE_KV, userId);
	if (balance <= 0 || balance < charge) {
		throw new Error("credits empty");
	}
	const locale = typeof record.locale === "string" ? record.locale : "en";
	const result = (await env.AI.run(CODE_TTS_MODEL, {
		prompt: text,
		lang: codeSttLanguage(locale),
	})) as unknown;
	const audio = audioBase64(result);
	if (!audio) {
		throw new Error("speech failed");
	}
	await consumeMicrodollars(env.DYNAMIC_PAGE_KV, userId, charge);
	return { audio };
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
