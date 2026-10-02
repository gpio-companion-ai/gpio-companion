import {
	USAGE_EMBED_MESSAGE_TYPE,
	USAGE_EMBED_READY_TYPE,
	type UsageEmbedPayload,
	usageEmbedInjectSource,
	usageEmbedUrl,
} from "gpio-companion-usage";

export {
	USAGE_EMBED_MESSAGE_TYPE,
	USAGE_EMBED_READY_TYPE,
	type UsageEmbedPayload,
	usageEmbedUrl,
};

export function mobileUsageEmbedUrl(
	origin: string,
	opts?: { locale?: string; theme?: string },
): string {
	return usageEmbedUrl(origin, opts);
}

export function usageEmbedScript(payload: UsageEmbedPayload): string {
	return usageEmbedInjectSource(payload);
}
