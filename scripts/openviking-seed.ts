#!/usr/bin/env bun
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import boardsJson from "../opencode/memory/boards.json";
import {
	familyFallbackSeed,
	parseBoardSeedManifest,
	resolveBoardSeed,
} from "../packages/core/src/board-seeds.ts";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CONFIG_DIR =
	process.env.GPIO_COMPANION_CONFIG_DIR ?? "/etc/gpio-companion";
const OV_BIN = process.env.OPENVIKING_OV_BIN ?? "ov";
const OV_TIMEOUT = "600";

function arg(name: string): string | undefined {
	const index = process.argv.indexOf(name);
	if (index === -1) {
		return undefined;
	}
	return process.argv[index + 1];
}

function fail(message: string): never {
	console.error(`openviking-seed: ${message}`);
	process.exit(1);
}

function readBoardModel(): string {
	try {
		const raw = readFileSync("/proc/device-tree/model", "utf8");
		return raw.replace(/\0/g, " ").replace(/\s+/g, " ").trim();
	} catch {
		return "";
	}
}

function readHardware(): string {
	const path = join(CONFIG_DIR, "config.json");
	if (!existsSync(path)) {
		return "";
	}
	try {
		const config = JSON.parse(readFileSync(path, "utf8")) as {
			hardware?: string;
		};
		return typeof config.hardware === "string" ? config.hardware : "";
	} catch {
		return "";
	}
}

function seedFiles(dir: string): string[] {
	const path = join(memoryRoot, dir);
	if (!existsSync(path)) {
		fail(`seed directory missing: ${dir}`);
	}
	return readdirSync(path)
		.filter((file) => file.endsWith(".md") || file.endsWith(".json"))
		.sort();
}

function run(args: string[]): { code: number; output: string } {
	const child = Bun.spawnSync([OV_BIN, ...args], {
		stdout: "pipe",
		stderr: "pipe",
	});
	return {
		code: child.exitCode ?? 1,
		output:
			`${child.stdout?.toString() ?? ""}${child.stderr?.toString() ?? ""}`.trim(),
	};
}

const repo = arg("--repo") ?? join(SCRIPT_DIR, "..");
const memoryRoot = join(repo, "opencode", "memory");

const manifest = parseBoardSeedManifest(boardsJson);
const model = readBoardModel();
let seed = model ? resolveBoardSeed(manifest, model) : null;
if (!seed) {
	const hardware = readHardware();
	seed = hardware ? familyFallbackSeed(manifest, hardware) : null;
}
if (!seed) {
	fail(
		`unknown board (model="${model}"); no matching seed in boards.json and no family fallback`,
	);
}
console.log(
	`openviking-seed: board "${model || seed.slug}" -> seed ${seed.slug} (${seed.exact ? "exact SKU" : "family fallback"})`,
);

const health = run(["health"]);
if (health.code !== 0) {
	fail(
		`openviking server not reachable via ov (ov health failed): ${health.output}`,
	);
}

const targets: Array<{ file: string; uri: string }> = [];
for (const file of seedFiles(seed.dir)) {
	targets.push({
		file: join(memoryRoot, seed.dir, file),
		uri: `viking://resources/gpio-companion/boards/${seed.slug}/${file}`,
	});
}
for (const file of seedFiles("core")) {
	targets.push({
		file: join(memoryRoot, "core", file),
		uri: `viking://resources/gpio-companion/core/${file}`,
	});
}

function assertEmbeddings(): void {
	const child = Bun.spawnSync(
		[
			"curl",
			"-sS",
			"-m",
			"20",
			"-o",
			"/tmp/gpio-ov-embed.json",
			"-w",
			"%{http_code}",
			"http://127.0.0.1:4150/v1/ai/embeddings",
			"-H",
			"content-type: application/json",
			"-H",
			"authorization: Bearer local",
			"-d",
			JSON.stringify({ input: "ping" }),
		],
		{ stdout: "pipe", stderr: "pipe" },
	);
	const status = child.stdout?.toString().trim() ?? "";
	if (status === "200") {
		return;
	}
	let body = child.stderr?.toString() ?? "";
	try {
		body = readFileSync("/tmp/gpio-ov-embed.json", "utf8");
	} catch {
		body = body.trim();
	}
	fail(
		`embeddings unavailable (HTTP ${status || child.exitCode}); pair this board before seeding. ${body.trim()}`,
	);
}

if (process.env.OPENVIKING_SEED_SKIP_EMBED_CHECK !== "1") {
	assertEmbeddings();
}

let added = 0;
for (const target of targets) {
	run(["rm", target.uri, "--recursive"]);
	const result = run([
		"add-resource",
		target.file,
		"--to",
		target.uri,
		"--wait",
		"--timeout",
		OV_TIMEOUT,
		"--processing-mode",
		"vectors_only",
	]);
	if (result.code !== 0) {
		fail(`could not seed ${target.uri}: ${result.output}`);
	}
	added += 1;
	console.log(`openviking-seed: seeded ${target.uri}`);
}

console.log(`openviking-seed: done (${added} resources under gpio-companion/)`);
