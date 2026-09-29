import {
	MODEL_EMBED_MESSAGE_TYPE,
	MODEL_EMBED_READY_TYPE,
	type ModelEmbedPayload,
	modelEmbedInjectSource,
	modelEmbedUrl,
} from "gpio-companion-model";

export {
	MODEL_EMBED_MESSAGE_TYPE,
	MODEL_EMBED_READY_TYPE,
	type ModelEmbedPayload,
	modelEmbedUrl,
};

export function mobileModelEmbedUrl(
	origin: string,
	opts?: { locale?: string; theme?: string },
): string {
	return modelEmbedUrl(origin, opts);
}

export function modelEmbedScript(payload: ModelEmbedPayload): string {
	return modelEmbedInjectSource(payload);
}
