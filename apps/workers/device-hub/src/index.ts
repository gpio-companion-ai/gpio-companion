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
		if (this.ctx.getWebSockets("pi").length > 0) {
			return;
		}
		await this.clearLive(state.uuid);
	}

	private broadcast(message: HubMessage, tag: HubRole): void {
		const body = encodeHubMessage(message);
		for (const socket of this.ctx.getWebSockets(tag)) {
			socket.send(body);
		}
	}

	private async replay(socket: WebSocket): Promise<void> {
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
		await this.env.DYNAMIC_PAGE_KV.put(
			`${LIVE_PREFIX}${uuid}`,
			JSON.stringify({
				uuid,
				deviceUrl: publicDeviceUrl(tunnelHostnames(uuid).apiHostname),
				seenAt: now,
			}),
			{ expirationTtl: HUB_LIVE_TTL_SEC },
		);
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
