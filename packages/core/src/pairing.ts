export type PairingClaim = {
	uuid: string;
	key: string;
	userId: string;
	email: string;
	login: string;
};

export type PairingPublic = {
	uuid: string;
	paired: boolean;
	login: string;
};

export type PairClaimNotice = "yours" | "other" | "other-pending";

export function pairClaimNotice(body: unknown): PairClaimNotice | null {
	if (!body || typeof body !== "object") {
		return null;
	}
	const record = body as {
		alreadyYours?: unknown;
		pending?: unknown;
		alreadyPaired?: unknown;
	};
	if (record.alreadyYours === true) {
		return "yours";
	}
	if (record.pending === true) {
		return "other-pending";
	}
	if (record.alreadyPaired === "other") {
		return "other";
	}
	return null;
}

export type PairingState = {
	uuid: string;
	key: string;
	claimed: boolean;
	userId: string;
	email: string;
	login: string;
	claimedAt: string;
};

export function emptyPairingState(uuid = "", key = ""): PairingState {
	return {
		uuid,
		key,
		claimed: false,
		userId: "",
		email: "",
		login: "",
		claimedAt: "",
	};
}

export function parsePairingClaim(input: unknown): PairingClaim {
	if (input === null || typeof input !== "object") {
		throw new Error("pairing claim must be an object");
	}
	const record = input as Record<string, unknown>;
	const uuid = requiredString(record.uuid, "uuid");
	const key = requiredString(record.key, "key");
	const userId = requiredString(record.userId, "userId");
	const email = optionalString(record.email);
	const login =
		optionalString(record.login) ||
		optionalString(record.giteaLogin) ||
		loginFromEmail(email) ||
		userId;
	return { uuid, key, userId, email, login };
}

export type PairingCredentials = {
	uuid: string;
	key: string;
	paired: boolean;
	userId: string;
	deviceUrl: string;
};

export function pairingCredentials(
	state: PairingState,
	deviceUrl = "",
): PairingCredentials {
	return {
		uuid: state.uuid,
		key: state.key,
		paired: state.claimed,
		userId: state.claimed ? state.userId : "",
		deviceUrl,
	};
}

export function parsePairingUnpair(input: unknown): {
	uuid: string;
	key: string;
} {
	if (input === null || typeof input !== "object") {
		throw new Error("unpair must be an object");
	}
	const record = input as Record<string, unknown>;
	return {
		uuid: requiredString(record.uuid, "uuid"),
		key: requiredString(record.key, "key"),
	};
}

export function publicPairing(state: PairingState): PairingPublic {
	return {
		uuid: state.uuid,
		paired: state.claimed,
		login: state.claimed ? state.login : "",
	};
}

export function loginFromEmail(email: string): string {
	const at = email.indexOf("@");
	if (at <= 0) {
		return email;
	}
	return email.slice(0, at);
}

function requiredString(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}
	return value.trim();
}

function optionalString(value: unknown): string {
	return typeof value === "string" ? value.trim() : "";
}
