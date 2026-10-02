import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type FetchLike, forgetAiCredentials } from "./ai-credentials.ts";
import { fetchDashboardProfile, syncProfile } from "./profile-sync.ts";
import { fileConfigStore } from "./store.ts";

function tempStore(): {
	store: ReturnType<typeof fileConfigStore>;
	path: string;
} {
	const dir = mkdtempSync(join(tmpdir(), "profile-sync-"));
	const path = join(dir, "config.json");
	return {
		store: fileConfigStore(path, "raspberrypi"),
		path,
	};
}

const UUID = "profile-sync-test-uuid";

afterEach(() => {
	forgetAiCredentials(UUID);
});

describe("profile sync", () => {
	test("pulls profile from dashboard and writes config", async () => {
		const { store, path } = tempStore();
		const calls: string[] = [];
		let credsMinted = 0;
		const fetchImpl: FetchLike = async (input, init) => {
			const url = String(input);
			calls.push(url);
			if (url.endsWith("/api/ai/credentials")) {
				credsMinted += 1;
				return Response.json({ token: "token-1", expiresAt: "2030-01-01" });
			}
			if (url.endsWith("/api/profile/device")) {
				const headers = new Headers(init?.headers);
				expect(headers.get("authorization")).toBe("Bearer token-1");
				return Response.json({
					profile: { level: "beginner", context: "education" },
				});
			}
			return new Response("not found", { status: 404 });
		};
		const profile = await syncProfile({
			store,
			uuid: UUID,
			key: "key",
			fetchImpl,
		});
		expect(profile).toEqual({ level: "beginner", context: "education" });
		expect(credsMinted).toBe(1);
		expect(calls.some((url) => url.endsWith("/api/profile/device"))).toBe(true);
		const written = JSON.parse(readFileSync(path, "utf8")) as {
			profile?: { level: string; context: string };
		};
		expect(written.profile).toEqual({
			level: "beginner",
			context: "education",
		});
		rmSync(path, { force: true });
	});

	test("skips rewrite when profile is unchanged", async () => {
		const { store, path } = tempStore();
		const fetchImpl: FetchLike = async (input) => {
			const url = String(input);
			if (url.endsWith("/api/ai/credentials")) {
				return Response.json({ token: "token-2", expiresAt: "2030-01-01" });
			}
			return Response.json({
				profile: { level: "expert", context: "lab" },
			});
		};
		await syncProfile({ store, uuid: UUID, key: "key", fetchImpl });
		const first = readFileSync(path, "utf8");
		await syncProfile({ store, uuid: UUID, key: "key", fetchImpl });
		expect(readFileSync(path, "utf8")).toBe(first);
		rmSync(path, { force: true });
	});

	test("keeps config untouched when dashboard returns no profile", async () => {
		const { store, path } = tempStore();
		const fetchImpl: FetchLike = async (input) => {
			const url = String(input);
			if (url.endsWith("/api/ai/credentials")) {
				return Response.json({ token: "token-3", expiresAt: "2030-01-01" });
			}
			return Response.json({ profile: null });
		};
		const profile = await fetchDashboardProfile({
			uuid: UUID,
			key: "key",
			fetchImpl,
		});
		expect(profile).toBeNull();
		expect((await store.read()).profile).toBeUndefined();
		rmSync(path, { force: true });
	});
});
