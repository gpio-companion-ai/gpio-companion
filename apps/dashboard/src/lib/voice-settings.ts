import { type CodeVoiceSettings, codeVoiceSettings } from "gpio-companion";

export async function getVoiceSettings(
	kv: KVNamespace,
	userId: string,
): Promise<CodeVoiceSettings> {
	const raw = await kv.get(`voice-settings:${userId}`);
	if (!raw) {
		return codeVoiceSettings(undefined);
	}
	try {
		return codeVoiceSettings(JSON.parse(raw));
	} catch {
		return codeVoiceSettings(undefined);
	}
}

export async function setVoiceSettings(
	kv: KVNamespace,
	userId: string,
	input: unknown,
): Promise<CodeVoiceSettings> {
	const next = codeVoiceSettings(input);
	await kv.put(`voice-settings:${userId}`, JSON.stringify({ v: 1, ...next }));
	return next;
}
