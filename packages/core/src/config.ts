export const HARDWARE_IDS = ["raspberrypi", "orangepi"] as const;

export const CONFIG_PROFILE_PATH = "/v1/config/profile";

export type HardwareId = (typeof HARDWARE_IDS)[number];

export const PROFILE_LEVELS = ["beginner", "intermediate", "expert"] as const;

export type ProfileLevel = (typeof PROFILE_LEVELS)[number];

export const PROFILE_CONTEXTS = ["home", "lab", "education"] as const;

export type ProfileContext = (typeof PROFILE_CONTEXTS)[number];

export type UserProfile = {
	level: ProfileLevel;
	context: ProfileContext;
};

export function parseUserProfile(input: unknown): UserProfile {
	if (input === null || typeof input !== "object") {
		throw new Error("profile must be an object");
	}
	const record = input as Record<string, unknown>;
	if (
		typeof record.level !== "string" ||
		!(PROFILE_LEVELS as readonly string[]).includes(record.level)
	) {
		throw new Error(
			`profile.level must be one of: ${PROFILE_LEVELS.join(", ")}`,
		);
	}
	if (
		typeof record.context !== "string" ||
		!(PROFILE_CONTEXTS as readonly string[]).includes(record.context)
	) {
		throw new Error(
			`profile.context must be one of: ${PROFILE_CONTEXTS.join(", ")}`,
		);
	}
	return {
		level: record.level as ProfileLevel,
		context: record.context as ProfileContext,
	};
}

export function profileFrom(input: unknown): UserProfile | null {
	try {
		return parseUserProfile(input);
	} catch {
		return null;
	}
}

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
	profile?: UserProfile;
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
	const profile = profileFrom(record.profile);
	return {
		hardware: record.hardware,
		tunnel,
		...(opencodePermission ? { opencodePermission } : {}),
		...(profile ? { profile } : {}),
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
