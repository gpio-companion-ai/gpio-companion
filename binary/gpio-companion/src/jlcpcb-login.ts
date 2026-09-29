import { rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export type PendingCliLogin = {
	authorizeUrl: string;
	state: string;
	finish(input: string): Promise<void>;
};

const pending = new Map<string, PendingCliLogin>();

export async function startJlcpcbLogin(
	start: () => Promise<PendingCliLogin> = spawnCliLogin,
): Promise<{ authorizeUrl: string; state: string }> {
	const login = await (start ?? spawnCliLogin)();
	if (!login.state || !login.authorizeUrl) {
		throw new Error("cli login failed");
	}
	pending.set(login.state, login);
	return { authorizeUrl: login.authorizeUrl, state: login.state };
}

export async function completeJlcpcbLogin(
	state: string,
	code: string,
): Promise<{ ok: true }> {
	const login = pending.get(state);
	if (!login) {
		throw new Error("cli login expired");
	}
	pending.delete(state);
	await login.finish(code);
	return { ok: true };
}

export async function clearCliSession(): Promise<void> {
	const clientID = "__gpio_companion_927ffcf9";
	await rm(join(homedir(), ".openauthster", `${clientID}.json`), {
		force: true,
	});
	await rm(join(homedir(), ".config", "gpio-jlcpcb", "mode.json"), {
		force: true,
	});
}

export async function spawnCliLogin(): Promise<PendingCliLogin> {
	const bin = process.env.GPIO_JLCPCB_BIN || "gpio-jlcpcb";
	const child = Bun.spawn([bin, "login-start"], {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
	});
	const reader = child.stdout.getReader();
	const chunk = await reader.read();
	const line = new TextDecoder().decode(chunk.value).split("\n")[0] ?? "";
	const started = JSON.parse(line) as { authorizeUrl?: string; state?: string };
	if (!started.authorizeUrl || !started.state) {
		throw new Error("cli login failed");
	}
	return {
		authorizeUrl: started.authorizeUrl,
		state: started.state,
		async finish(input) {
			child.stdin.write(new TextEncoder().encode(`${input}\n`));
			await child.stdin.end();
			const code = await child.exited;
			if (code !== 0) {
				throw new Error("cli login failed");
			}
		},
	};
}
