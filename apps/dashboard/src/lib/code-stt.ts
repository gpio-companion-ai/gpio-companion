import {
	CODE_STT_MAX_BYTES,
	CODE_STT_MAX_MS,
	CODE_STT_MODEL,
	codeSttLanguage,
	codeSttMicros,
	decodeBase64,
	parseMarkup,
} from "gpio-companion";
import { consumeMicrodollars, creditsBalance } from "./credits.ts";

type SttEnv = {
	DYNAMIC_PAGE_KV: KVNamespace;
	AI?: Ai;
	GPIO_AI_MARKUP?: string;
};

export async function transcribeCodeAudio(
	env: SttEnv,
	userId: string,
	input: unknown,
): Promise<{ text: string }> {
	const record =
		input && typeof input === "object" && !Array.isArray(input)
			? (input as Record<string, unknown>)
			: {};
	const audio = typeof record.audio === "string" ? record.audio.trim() : "";
	if (!audio) {
		throw new Error("file is required");
	}
	const bytes = decodeBase64(audio);
	if (bytes.byteLength === 0 || bytes.byteLength > CODE_STT_MAX_BYTES) {
		throw new Error("file is too large");
	}
	if (!env.AI) {
		throw new Error("workers ai is not bound");
	}
	const markup = parseMarkup(env.GPIO_AI_MARKUP);
	const estimate = codeSttMicros(CODE_STT_MAX_MS / 1000, markup);
	const balance = await creditsBalance(env.DYNAMIC_PAGE_KV, userId);
	if (balance <= 0 || balance < estimate) {
		throw new Error("credits empty");
	}
	const locale = typeof record.locale === "string" ? record.locale : "en";
	const result = (await env.AI.run(CODE_STT_MODEL, {
		audio,
		task: "transcribe",
		language: codeSttLanguage(locale),
		vad_filter: true,
	})) as {
		text?: unknown;
		transcription_info?: { duration?: unknown };
	};
	const duration =
		typeof result.transcription_info?.duration === "number"
			? result.transcription_info.duration
			: CODE_STT_MAX_MS / 1000;
	await consumeMicrodollars(
		env.DYNAMIC_PAGE_KV,
		userId,
		codeSttMicros(duration, markup),
	);
	return { text: typeof result.text === "string" ? result.text.trim() : "" };
}
