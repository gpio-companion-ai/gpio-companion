export const HARDWARE_IDS = ["raspberrypi", "orangepi"] as const;

export type HardwareId = (typeof HARDWARE_IDS)[number];

export type TunnelConfig = {
	token: string;
	hostname: string;
	apiHostname: string;
	tunnelId: string;
};

export type DeviceConfig = {
	hardware: HardwareId;
	tunnel: TunnelConfig;
	opencodePermission?: "ask" | "full";
};

export function emptyTunnelConfig(): TunnelConfig {
	return {
		token: "",
		hostname: "",
		apiHostname: "",
		tunnelId: "",
	};
}

export function emptyDeviceConfig(hardware: HardwareId): DeviceConfig {
	return {
		hardware,
		tunnel: emptyTunnelConfig(),
	};
}

export function isHardwareId(value: unknown): value is HardwareId {
	return (
		typeof value === "string" &&
		(HARDWARE_IDS as readonly string[]).includes(value)
	);
}

export function parseDeviceConfig(input: unknown): DeviceConfig {
	if (input === null || typeof input !== "object") {
		throw new Error("config must be an object");
	}
	const record = input as Record<string, unknown>;
	if (!isHardwareId(record.hardware)) {
		throw new Error(`hardware must be one of: ${HARDWARE_IDS.join(", ")}`);
	}
	const tunnel = parseTunnelConfig(record.tunnel);
	const opencodePermission =
		record.opencodePermission === "ask" || record.opencodePermission === "full"
			? record.opencodePermission
			: undefined;
	return {
		hardware: record.hardware,
		tunnel,
		...(opencodePermission ? { opencodePermission } : {}),
	};
}

export function deviceOpencodePermissionMode(
	config: DeviceConfig | undefined,
): "ask" | "full" {
	return config?.opencodePermission === "full" ? "full" : "ask";
}

export function parseTunnelConfig(input: unknown): TunnelConfig {
	if (input === null || typeof input !== "object") {
		throw new Error("tunnel must be an object");
	}
	const record = input as Record<string, unknown>;
	if (typeof record.token !== "string") {
		throw new Error("tunnel.token must be a string");
	}
	if (typeof record.hostname !== "string") {
		throw new Error("tunnel.hostname must be a string");
	}
	return {
		token: record.token.trim(),
		hostname: record.hostname.trim(),
		apiHostname:
			typeof record.apiHostname === "string" ? record.apiHostname.trim() : "",
		tunnelId: typeof record.tunnelId === "string" ? record.tunnelId.trim() : "",
	};
}

export function redactDeviceConfig(config: DeviceConfig): DeviceConfig {
	return {
		...config,
		tunnel: {
			...config.tunnel,
			token: config.tunnel.token ? "***" : "",
		},
	};
}
