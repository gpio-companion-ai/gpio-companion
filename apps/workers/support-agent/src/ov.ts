import { clipExcerpt, type OvCall, ovRequest } from "gpio-companion";

export type OpenVikingBinding = {
	fetch(input: RequestInfo, init?: RequestInit): Promise<Response>;
};

export async function queryOpenViking(
	binding: OpenVikingBinding | undefined,
	apiKey: string | undefined,
	call: OvCall,
): Promise<string> {
	const request = ovRequest(call);
	if (!binding) {
		return "project lookup is unavailable";
	}
	const headers = new Headers({ accept: "application/json" });
	if (apiKey?.trim()) {
		headers.set("X-API-Key", apiKey.trim());
	}
	if (request.body) {
		headers.set("content-type", "application/json");
	}
	let response: Response;
	try {
		response = await binding.fetch(`http://127.0.0.1:1933${request.path}`, {
			method: request.method,
			headers,
			body: request.body ? JSON.stringify(request.body) : undefined,
		});
	} catch {
		return "project lookup is unavailable";
	}
	if (!response.ok) {
		return "project lookup is unavailable";
	}
	const raw = await response.text();
	return clipExcerpt(raw || "no project matches");
}
