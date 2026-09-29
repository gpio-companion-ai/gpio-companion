export const TUNNEL_ZONE = "gpio-companion.com";
export const DASHBOARD_ORIGIN = `https://${TUNNEL_ZONE}`;
export const DEVICE_API_PORT = 4150;

export type TunnelHostnames = {
	slug: string;
	apiHostname: string;
};

export function pairingSlug(uuid: string): string {
	return uuid.trim().replaceAll("-", "").toLowerCase();
}

export function tunnelHostnames(
	uuid: string,
	zone = TUNNEL_ZONE,
): TunnelHostnames {
	const slug = pairingSlug(uuid);
	return {
		slug,
		apiHostname: `api-${slug}.${zone}`,
	};
}

export function cloudflareTunnelName(uuid: string): string {
	return `gpio-${uuid.trim()}`;
}

export function publicDeviceUrl(apiHostname: string): string {
	const host = apiHostname.trim().replace(/\/+$/, "");
	if (!host) {
		return "";
	}
	if (host.startsWith("http://") || host.startsWith("https://")) {
		return host;
	}
	return `https://${host}`;
}

export function pairingUuidFromDeviceUrl(deviceUrl: string): string {
	const origin = publicDeviceUrl(deviceUrl);
	if (!origin) {
		return "";
	}
	let host = origin;
	try {
		host = new URL(origin).hostname;
	} catch {
		host = origin.replace(/^https?:\/\//, "").split("/")[0] ?? "";
	}
	const match = host.toLowerCase().match(/^api-([0-9a-f]{32})\./);
	const slug = match?.[1] ?? "";
	if (slug.length !== 32) {
		return "";
	}
	return `${slug.slice(0, 8)}-${slug.slice(8, 12)}-${slug.slice(12, 16)}-${slug.slice(16, 20)}-${slug.slice(20)}`;
}
