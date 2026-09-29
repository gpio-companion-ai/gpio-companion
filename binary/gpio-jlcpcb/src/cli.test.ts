import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { run, startCliLogin } from "./cli.ts";

describe("gpio-jlcpcb", () => {
	test("dashboard callback login exchanges with the dashboard redirect", async () => {
		const redirects: string[] = [];
		let persisted = false;
		await startCliLogin({
			redirectURI: "https://gpio-companion.com/auth/cli/callback",
			authorize: async (redirectURI) => {
				redirects.push(redirectURI);
				return {
					url: "https://issuer.example/authorize",
					challenge: { verifier: "verifier-1", state: "state-1" },
				};
			},
			readCode: async () =>
				"https://gpio-companion.com/auth/cli/callback?code=code-1&state=state-1",
			exchange: async (code, redirectURI, verifier) => {
				expect(code).toBe("code-1");
				expect(redirectURI).toBe("https://gpio-companion.com/auth/cli/callback");
				expect(verifier).toBe("verifier-1");
				return {
					tokens: { access: "access", refresh: "refresh", expiresIn: 60 },
				};
			},
			persist: async () => {
				persisted = true;
			},
		});
		expect(redirects).toEqual([
			"https://gpio-companion.com/auth/cli/callback",
		]);
		expect(persisted).toBe(true);
	});

	test("writes a draft and pushes it through dashboard login", async () => {
		const cwd = await mkdtemp(join(tmpdir(), "gpio-jlcpcb-"));
		const home = await mkdtemp(join(tmpdir(), "gpio-jlcpcb-home-"));
		await Bun.write(
			join(cwd, "model", "manifest.json"),
			JSON.stringify({
				parts: [
					{ name: "header-clip", file: "header-clip.glb" },
					{ name: "arduino-header-clip", file: "arduino-header-clip.glb" },
				],
			}),
		);
		await Bun.write(join(cwd, "pcb", "board.zip"), "zip");
		const lines: string[] = [];
		const io = {
			cwd,
			home,
			stdout: (line: string) => lines.push(line),
			stderr: (line: string) => lines.push(line),
			fetchImpl: async (input: string | URL, init?: RequestInit) => {
				const url = String(input);
				if (
					url.endsWith("/v1/jlcpcb") &&
					(!init?.method || init.method === "GET")
				) {
					return Response.json({ ok: true, data: { configured: true } });
				}
				if (url.endsWith("/v1/jlcpcb/draft") && init?.method === "PUT") {
					const body = JSON.parse(String(init.body));
					expect(body.prints).toEqual([
						{ name: "header-clip", file: "model/header-clip.stl" },
						{
							name: "arduino-header-clip",
							file: "model/arduino-header-clip.stl",
						},
					]);
					expect(body.pcb.file).toBe("pcb/board.zip");
					expect(body.parts[0].componentCode).toBe("C2040");
					return Response.json({ ok: true, data: { draft: body } });
				}
				return Response.json(
					{ ok: false, error: "unexpected" },
					{ status: 500 },
				);
			},
		};
		expect(await run(["login", "--dashboard"], io)).toBe(0);
		expect(await run(["draft", "init", "--repo", "ada/blink"], io)).toBe(0);
		expect(await run(["draft", "add-part", "C2040", "--qty", "2"], io)).toBe(0);
		expect(await run(["draft", "push"], io)).toBe(0);
		const stored = JSON.parse(
			await readFile(join(cwd, "order", "jlcpcb.json"), "utf8"),
		);
		expect(stored.assembly.lines).toEqual([{ componentCode: "C2040", qty: 2 }]);
		expect(stored.repo).toBe("ada/blink");
	});

	test("keyword search uses the dashboard proxy and does not order", async () => {
		const home = await mkdtemp(join(tmpdir(), "gpio-jlcpcb-home-"));
		const calls: string[] = [];
		const io = {
			cwd: "/tmp",
			home,
			stdout: () => undefined,
			stderr: () => undefined,
			fetchImpl: async (input: string | URL, init?: RequestInit) => {
				calls.push(`${init?.method ?? "GET"} ${String(input)}`);
				if (String(input).endsWith("/v1/jlcpcb") && init?.method === "POST") {
					expect(String(init.body)).toContain("10k 0603");
					expect(String(init.body)).not.toContain("createOrder");
					return Response.json({
						ok: true,
						data: {
							parts: [{ componentCode: "C2040", name: "10k", package: "0603" }],
						},
					});
				}
				if (String(input).endsWith("/v1/jlcpcb")) {
					return Response.json({ ok: true, data: { configured: false } });
				}
				return Response.json(
					{ ok: false, error: "unexpected" },
					{ status: 500 },
				);
			},
		};
		expect(await run(["login", "--dashboard"], io)).toBe(0);
		expect(await run(["parts", "10k", "0603"], io)).toBe(0);
		expect(calls.some((call) => call.includes("createOrder"))).toBe(false);
	});
});
