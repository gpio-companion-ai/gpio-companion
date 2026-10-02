import { DurableObject } from "cloudflare:workers";
import {
	encodeHubMessage,
	HUB_LIVE_TTL_SEC,
	type HubChannel,
	type HubMessage,
	type HubRole,
	isHubChannel,
	parseHubMessage,
} from "../../../../packages/core/src/hub-message.ts";
import {
	publicDeviceUrl,
	tunnelHostnames,
} from "../../../../packages/core/src/tunnel-host.ts";

export type Env = {
	DEVICE_HUB: DurableObjectNamespace<DeviceHub>;
	DYNAMIC_PAGE_KV: KVNamespace;
};

type SocketState = {
	role: HubRole;
	uuid: string;
};

const LIVE_PREFIX = "live:";
const RECONNECT_GRACE_MS = 5_000;
type PresenceState = {
	uuid: string;
	online: boolean;
	seenAt: number;
	offlineAt?: number;
};

export class DeviceHub extends DurableObject<Env> {
	override async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
			return new Response("expected websocket", { status: 426 });
		}
		const url = new URL(request.url);
		const role = url.searchParams.get("role");
		const uuid = url.searchParams.get("uuid")?.trim() ?? "";
		if ((role !== "pi" && role !== "dashboard") || !uuid) {
			return new Response("invalid hub socket", { status: 400 });
		}
		const pair = new WebSocketPair();
		const client = pair[0];
		const server = pair[1];
		if (!client || !server) {
			return new Response("websocket pair failed", { status: 500 });
		}
		if (role === "pi") {
			for (const socket of this.ctx.getWebSockets("pi")) {
				socket.close(4000, "replaced");
			}
		}
		this.ctx.acceptWebSocket(server, [role]);
		server.serializeAttachment({ role, uuid } satisfies SocketState);
		if (role === "pi") {
			await this.markLive(uuid);
		} else {
			await this.replay(server);
		}
		return new Response(null, { status: 101, webSocket: client });
	}

	override async webSocketMessage(
		ws: WebSocket,
		message: string | ArrayBuffer,
	): Promise<void> {
		const state = attachment(ws);
		if (state?.role !== "pi") {
			return;
		}
		// A replaced or timed-out socket must not revive the board.
		if (
			ws.readyState !== WebSocket.OPEN ||
			!this.ctx.getWebSockets("pi").includes(ws)
		)
			return;
		const parsed = parseHubMessage(
			typeof message === "string" ? message : new TextDecoder().decode(message),
		);
		if (!parsed) {
			return;
		}
		if (parsed.type === "ping" || parsed.type === "hello") {
			await this.markLive(state.uuid);
			return;
		}
		if (!isHubChannel(parsed.type)) {
			return;
		}
		await this.ctx.storage.put(parsed.type, parsed.payload ?? null);
		this.broadcast(parsed, "dashboard");
		await this.markLive(state.uuid);
	}

	override async webSocketClose(
		ws: WebSocket,
		_code: number,
		_reason: string,
	): Promise<void> {
		const state = attachment(ws);
		if (state?.role !== "pi" || !state.uuid) {
			return;
		}
		if (
			this.ctx
				.getWebSockets("pi")
				.some((socket) => socket !== ws && socket.readyState === WebSocket.OPEN)
		) {
			return;
		}
		await this.scheduleOffline(state.uuid);
	}

	override async webSocketError(ws: WebSocket): Promise<void> {
		ws.close(1011, "socket error");
		const state = attachment(ws);
		if (
			state?.role === "pi" &&
			!this.ctx
				.getWebSockets("pi")
				.some((socket) => socket !== ws && socket.readyState === WebSocket.OPEN)
		) {
			await this.scheduleOffline(state.uuid);
		}
	}

	private async scheduleOffline(uuid: string): Promise<void> {
		const presence = await this.ctx.storage.get<PresenceState>("presence");
		if (!presence?.online) return;
		const offlineAt = presence.offlineAt ?? Date.now() + RECONNECT_GRACE_MS;
		await this.ctx.storage.put("presence", { ...presence, uuid, offlineAt });
		await this.ctx.storage.setAlarm(offlineAt);
	}

	override async alarm(): Promise<void> {
		const presence = await this.ctx.storage.get<PresenceState>("presence");
		if (!presence?.online) return;
		const deadline =
			presence.offlineAt ?? presence.seenAt + HUB_LIVE_TTL_SEC * 1000;
		if (Date.now() < deadline) {
			await this.ctx.storage.setAlarm(deadline);
			return;
		}
		for (const socket of this.ctx.getWebSockets("pi"))
			socket.close(4001, "heartbeat timeout");
		await this.clearLive(presence.uuid);
		await this.ctx.storage.put("presence", {
			uuid: presence.uuid,
			online: false,
			seenAt: presence.seenAt,
		});
		this.broadcast(
			{
				v: 1,
				type: "presence",
				payload: { uuid: presence.uuid, online: false, snapshot: false },
			},
			"dashboard",
		);
	}

	private broadcast(message: HubMessage, tag: HubRole): void {
		const body = encodeHubMessage(message);
		for (const socket of this.ctx.getWebSockets(tag)) {
			try {
				socket.send(body);
			} catch {
				/* A closing viewer cannot block presence updates. */
			}
		}
	}

	private async replay(socket: WebSocket): Promise<void> {
		const state = attachment(socket);
		const presence = await this.ctx.storage.get<PresenceState>("presence");
		const online = presence
			? presence.online &&
				Date.now() <
					(presence.offlineAt ?? presence.seenAt + HUB_LIVE_TTL_SEC * 1000)
			: this.ctx
					.getWebSockets("pi")
					.some((socket) => socket.readyState === WebSocket.OPEN);
		socket.send(
			encodeHubMessage({
				v: 1,
				type: "presence",
				payload: { uuid: state?.uuid, online, snapshot: true },
			}),
		);
		for (const channel of ["flash", "run", "arduinoProxy"] as HubChannel[]) {
			const payload = await this.ctx.storage.get(channel);
			if (payload === undefined || payload === null) {
				continue;
			}
			socket.send(encodeHubMessage({ v: 1, type: channel, payload }));
		}
	}

	private async markLive(uuid: string): Promise<void> {
		const now = Date.now();
		const previous = await this.ctx.storage.get<PresenceState>("presence");
		await this.ctx.storage.put("presence", {
			uuid,
			online: true,
			seenAt: now,
		} satisfies PresenceState);
		await this.ctx.storage.setAlarm(now + HUB_LIVE_TTL_SEC * 1000);
		await this.env.DYNAMIC_PAGE_KV.put(
			`${LIVE_PREFIX}${uuid}`,
			JSON.stringify({
				uuid,
				deviceUrl: publicDeviceUrl(tunnelHostnames(uuid).apiHostname),
				seenAt: now,
			}),
			{ expirationTtl: HUB_LIVE_TTL_SEC },
		);
		if (!previous?.online) {
			this.broadcast(
				{
					v: 1,
					type: "presence",
					payload: { uuid, online: true, snapshot: false },
				},
				"dashboard",
			);
		}
	}

	private async clearLive(uuid: string): Promise<void> {
		await this.env.DYNAMIC_PAGE_KV.delete(`${LIVE_PREFIX}${uuid}`);
	}
}

export default {
	fetch(): Response {
		return new Response("not found", { status: 404 });
	},
};

function attachment(ws: WebSocket): SocketState | null {
	const value = ws.deserializeAttachment() as SocketState | null;
	if (!value || (value.role !== "pi" && value.role !== "dashboard")) {
		return null;
	}
	if (typeof value.uuid !== "string" || !value.uuid.trim()) {
		return null;
	}
	return value;
}
