#!/usr/bin/env bun
/**
 * kit-add: insert a marketplace kit (draft product) into D1 via wrangler.
 *
 * Usage:
 *   bun run kit:add -- --file kits/base-opi-3lts.json --remote
 *   bun run kit:add -- --file kits/base-opi-3lts.json --local
 *
 * The kit JSON mirrors the admin ProductDraftInput. Inserted rows are always
 * status 'draft'; priceCents may be null (not purchasable until an admin sets
 * a price and publishes). Idempotent: skips when slug or SKU already exists.
 */

import { join } from "node:path";

const DB_BINDING = "MARKETPLACE_DB";
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKU_PATTERN = /^[A-Z0-9]+(?:[-_][A-Z0-9]+)*$/;
const APP_ROOT = join(import.meta.dir, "..");

export interface KitInput {
	slug: string;
	sku: string;
	nameEn: string;
	nameFr: string;
	descriptionEn: string;
	descriptionFr: string;
	priceCents: number | null;
	weightGrams?: number | null;
	lengthCm?: number | null;
	widthCm?: number | null;
	heightCm?: number | null;
}

export interface NormalizedKit {
	id: string;
	slug: string;
	sku: string;
	nameEn: string;
	nameFr: string;
	descriptionEn: string;
	descriptionFr: string;
	priceCents: number | null;
	weightGrams: number | null;
	lengthCm: number | null;
	widthCm: number | null;
	heightCm: number | null;
}

function requireText(value: unknown, label: string): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${label} is required`);
	}
	return value.trim();
}

function assertCents(value: unknown): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
		throw new Error("priceCents must be null or a non-negative integer");
	}
	return value;
}

function assertPositiveAmount(value: unknown, label: string): number | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

/** Mirrors normalizeProductInput + the publication slug/SKU rules. */
export function normalizeKitInput(raw: unknown): NormalizedKit {
	if (typeof raw !== "object" || raw === null) {
		throw new Error("Kit file must contain a JSON object");
	}
	const input = raw as Record<string, unknown>;
	const slug = requireText(input.slug, "slug").toLowerCase();
	const sku = requireText(input.sku, "sku").toUpperCase();
	if (!SLUG_PATTERN.test(slug)) {
		throw new Error(`Slug is invalid: ${slug}`);
	}
	if (!SKU_PATTERN.test(sku)) {
		throw new Error(`SKU is invalid: ${sku}`);
	}
	return {
		id: generateProductId(),
		slug,
		sku,
		nameEn: requireText(input.nameEn, "nameEn"),
		nameFr: requireText(input.nameFr, "nameFr"),
		descriptionEn: requireText(input.descriptionEn, "descriptionEn"),
		descriptionFr: requireText(input.descriptionFr, "descriptionFr"),
		priceCents: assertCents(input.priceCents),
		weightGrams: assertPositiveAmount(input.weightGrams, "weightGrams"),
		lengthCm: assertPositiveAmount(input.lengthCm, "lengthCm"),
		widthCm: assertPositiveAmount(input.widthCm, "widthCm"),
		heightCm: assertPositiveAmount(input.heightCm, "heightCm"),
	};
}

/** Same shape as generateCommerceId("prd"): prd_ + 32 hex. */
export function generateProductId(): string {
	return `prd_${crypto.randomUUID().replaceAll("-", "")}`;
}

export function escapeSql(value: string): string {
	return `'${value.replaceAll("'", "''")}'`;
}

function sqlNumberOrNull(value: number | null): string {
	return value === null ? "null" : String(value);
}

export function buildInsertSql(kit: NormalizedKit, now: number): string {
	const values = [
		escapeSql(kit.id),
		escapeSql(kit.slug),
		escapeSql(kit.sku),
		escapeSql(kit.nameEn),
		escapeSql(kit.nameFr),
		escapeSql(kit.descriptionEn),
		escapeSql(kit.descriptionFr),
		sqlNumberOrNull(kit.priceCents),
		sqlNumberOrNull(kit.weightGrams),
		sqlNumberOrNull(kit.lengthCm),
		sqlNumberOrNull(kit.widthCm),
		sqlNumberOrNull(kit.heightCm),
		"'draft'",
		String(now),
		String(now),
		"null",
	].join(", ");
	return `INSERT INTO products (id, slug, sku, name_en, name_fr, description_en, description_fr, price_cents, weight_grams, length_cm, width_cm, height_cm, status, created_at, updated_at, published_at) VALUES (${values})`;
}

interface D1Result {
	results: Array<Record<string, unknown>>;
	success: boolean;
}

function parseD1Output(stdout: string): D1Result[] {
	const start = stdout.indexOf("[");
	if (start === -1) {
		throw new Error(`Unexpected wrangler output: ${stdout.slice(0, 400)}`);
	}
	return JSON.parse(stdout.slice(start)) as D1Result[];
}

function runWrangler(args: string[]): D1Result[] {
	const proc = Bun.spawnSync(
		[process.execPath, "x", "wrangler", "d1", "execute", DB_BINDING, ...args],
		{ cwd: APP_ROOT, stdout: "pipe", stderr: "pipe" },
	);
	const stdout = proc.stdout.toString();
	if (proc.exitCode !== 0) {
		throw new Error(
			`wrangler exited with code ${proc.exitCode}\n${proc.stderr.toString() || stdout}`,
		);
	}
	return parseD1Output(stdout);
}

function query(
	sql: string,
	target: "--local" | "--remote",
): D1Result["results"] {
	const targetArgs = target === "--remote" ? ["--remote", "-y"] : ["--local"];
	const [statement] = runWrangler([...targetArgs, "--json", "--command", sql]);
	if (!statement?.success) {
		throw new Error(`Query failed: ${sql}`);
	}
	return statement.results;
}

function printSummary(row: Record<string, unknown>): void {
	console.log("Inserted kit:");
	for (const key of [
		"id",
		"slug",
		"sku",
		"name_en",
		"name_fr",
		"price_cents",
		"status",
	]) {
		console.log(`  ${key}: ${row[key] ?? "null"}`);
	}
}

async function main(): Promise<number> {
	const argv = process.argv.slice(2);
	const fileIndex = argv.indexOf("--file");
	const file = fileIndex !== -1 ? argv[fileIndex + 1] : undefined;
	const remote = argv.includes("--remote");
	const local = argv.includes("--local");
	if (!file) {
		console.error(
			"Usage: bun run kit:add -- --file <kit.json> --local|--remote",
		);
		return 1;
	}
	if (remote === local) {
		console.error("Pass exactly one of --local or --remote");
		return 1;
	}

	const raw: unknown = await Bun.file(join(process.cwd(), file)).json();
	const kit = normalizeKitInput(raw);
	console.log(
		`Kit ${kit.slug} (SKU ${kit.sku}) target ${remote ? "remote" : "local"} D1`,
	);

	const existing = query(
		`SELECT id, slug, sku, status FROM products WHERE slug = ${escapeSql(kit.slug)} OR sku = ${escapeSql(kit.sku)}`,
		remote ? "--remote" : "--local",
	);
	if (existing.length > 0) {
		console.log("Already exists, skipping:");
		for (const row of existing) {
			console.log(
				`  id=${row.id} slug=${row.slug} sku=${row.sku} status=${row.status}`,
			);
		}
		return 0;
	}

	query(
		buildInsertSql(kit, Math.floor(Date.now() / 1000)),
		remote ? "--remote" : "--local",
	);
	const [inserted] = query(
		`SELECT id, slug, sku, name_en, name_fr, price_cents, status FROM products WHERE id = ${escapeSql(kit.id)}`,
		remote ? "--remote" : "--local",
	);
	if (!inserted) {
		throw new Error(`Insert reported success but row ${kit.id} was not found`);
	}
	printSummary(inserted);
	return 0;
}

if (import.meta.main) {
	process.exitCode = await main();
}
