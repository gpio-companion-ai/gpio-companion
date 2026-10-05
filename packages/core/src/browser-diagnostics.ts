import { redactSecrets } from "./redact.ts";

export const BROWSER_DIAGNOSTICS_MAX = 20;
export const BROWSER_DIAGNOSTICS_TEXT_MAX = 240;
export const BROWSER_DIAGNOSTICS_BODY_MAX = 8000;

export type BrowserConsoleLine = {
	level: "error" | "warn";
	text: string;
	at: string;
};

export type BrowserNetworkLine = {
	method: string;
	path: string;
	status: number;
	at: string;
};

export type BrowserDiagnostics = {
	console: BrowserConsoleLine[];
	network: BrowserNetworkLine[];
};

const consoleLines: BrowserConsoleLine[] = [];
const networkLines: BrowserNetworkLine[] = [];
let installed = false;

function push<T>(list: T[], item: T) {
	list.push(item);
	if (list.length > BROWSER_DIAGNOSTICS_MAX) {
		list.shift();
	}
}

export function recordBrowserConsole(
	level: "error" | "warn",
	text: string,
): void {
	const clean = redactSecrets(text)
		.trim()
		.slice(0, BROWSER_DIAGNOSTICS_TEXT_MAX);
	if (!clean) {
		return;
	}
	push(consoleLines, { level, text: clean, at: new Date().toISOString() });
}

export function recordBrowserNetwork(
	method: string,
	url: string,
	status: number,
): void {
	if (status > 0 && status < 400) {
		return;
	}
	let path = url;
	try {
		const parsed = new URL(url, "https://gpio-companion.local");
		path = parsed.pathname;
	} catch {
		path = url.split("?")[0] ?? url;
	}
	push(networkLines, {
		method: method.toUpperCase().slice(0, 8) || "GET",
		path: redactSecrets(path).slice(0, BROWSER_DIAGNOSTICS_TEXT_MAX),
		status,
		at: new Date().toISOString(),
	});
}

export function readBrowserDiagnostics(): BrowserDiagnostics {
	return {
		console: consoleLines.slice(),
		network: networkLines.slice(),
	};
}

export function browserDiagnosticsBody(): string {
	return JSON.stringify(readBrowserDiagnostics()).slice(
		0,
		BROWSER_DIAGNOSTICS_BODY_MAX,
	);
}

type ConsoleLike = {
	error: (...args: unknown[]) => void;
	warn: (...args: unknown[]) => void;
};

type FetchLike = (
	input: string | URL,
	init?: { method?: string },
) => Promise<{ ok: boolean; status: number }>;

export function installBrowserDiagnosticsHere(): void {
	const target = globalThis as {
		console?: ConsoleLike;
		fetch?: FetchLike;
		addEventListener?: (
			type: string,
			listener: (event: { message?: string; reason?: unknown }) => void,
		) => void;
	};
	if (!target.console || !target.fetch) {
		return;
	}
	installBrowserDiagnostics({
		console: target.console,
		fetch: target.fetch,
		addEventListener: target.addEventListener?.bind(target),
	});
}

export function installBrowserDiagnostics(target: {
	console: ConsoleLike;
	fetch: FetchLike;
	addEventListener?: (
		type: string,
		listener: (event: { message?: string; reason?: unknown }) => void,
	) => void;
}): void {
	if (installed) {
		return;
	}
	installed = true;
	const originalError = target.console.error.bind(target.console);
	const originalWarn = target.console.warn.bind(target.console);
	target.console.error = (...args: unknown[]) => {
		recordBrowserConsole("error", args.map(String).join(" "));
		originalError(...args);
	};
	target.console.warn = (...args: unknown[]) => {
		recordBrowserConsole("warn", args.map(String).join(" "));
		originalWarn(...args);
	};
	const originalFetch = target.fetch.bind(target);
	target.fetch = async (input, init) => {
		const method = init?.method ?? "GET";
		const url = typeof input === "string" ? input : input.href;
		try {
			const response = await originalFetch(input, init);
			if (!response.ok) {
				recordBrowserNetwork(method, url, response.status);
			}
			return response;
		} catch (caught) {
			recordBrowserNetwork(method, url, 0);
			throw caught;
		}
	};
	target.addEventListener?.("error", (event) => {
		if (event.message) {
			recordBrowserConsole("error", event.message);
		}
	});
	target.addEventListener?.("unhandledrejection", (event) => {
		recordBrowserConsole(
			"error",
			String(event.reason ?? "unhandled rejection"),
		);
	});
}
