export const BOARD_PRESENCE_SOUND_KEY = "gpio-companion-presence-sounds";

export type BoardPresence = {
	uuid: string;
	online: boolean;
	snapshot: boolean;
};

export function asBoardPresence(value: unknown): BoardPresence | null {
	if (!value || typeof value !== "object") return null;
	const record = value as Partial<BoardPresence>;
	if (
		typeof record.uuid !== "string" ||
		!record.uuid.trim() ||
		typeof record.online !== "boolean" ||
		typeof record.snapshot !== "boolean"
	)
		return null;
	return {
		uuid: record.uuid,
		online: record.online,
		snapshot: record.snapshot,
	};
}

// A reconnect snapshot is a new baseline, never an offline/online alert.
export class BoardPresenceTracker {
	private online: boolean | undefined;
	accept(presence: BoardPresence): boolean {
		const changed =
			this.online !== undefined && this.online !== presence.online;
		this.online = presence.online;
		return !presence.snapshot && changed;
	}
}
