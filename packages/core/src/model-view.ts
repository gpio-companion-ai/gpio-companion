export const MODEL_DIR = "model";
export const MODEL_MANIFEST = "manifest.json";
export const MODEL_MANIFEST_PATH = "model/manifest.json";
export const MODEL_UNITS = "mm";
export const MODEL_TOOL = "trimesh";
export const MODEL_FILE_MAX_BYTES = 8 * 1024 * 1024;
export const MODEL_FITS = [
	"companion-header",
	"arduino-uno",
	"arduino-nano",
	"arduino-mega",
] as const;

const PART_FILE = /^[a-z0-9]+(?:-[a-z0-9]+)*\.glb$/;
const PART_KEYS = ["name", "file", "units", "fits"] as const;
const MANIFEST_KEYS = ["version", "units", "tool", "parts"] as const;

export const MODEL_EMBED_MESSAGE_TYPE = "gpio-model";
export const MODEL_EMBED_READY_TYPE = "gpio-model-ready";
export const MODEL_EMBED_BRIDGE_KEY = "__gpioModelEmbed";
export const MODEL_EMBED_PENDING_KEY = "__gpioModelPending";
export const MODEL_EMBED_PATH = "/embed/model";

export type ModelFit = (typeof MODEL_FITS)[number];

export type ModelPart = {
	name: string;
	file: string;
	units: typeof MODEL_UNITS;
	fits: ModelFit[];
};

export type ModelManifest = {
	version: 1;
	units: typeof MODEL_UNITS;
	tool: typeof MODEL_TOOL;
	parts: ModelPart[];
};

export type ModelEmbedPayload = {
	type: typeof MODEL_EMBED_MESSAGE_TYPE;
	glbBase64?: string | null;
};

export class ModelManifestError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelManifestError";
	}
}

export function isModelRepoPath(path: string): boolean {
	if (path.includes("..") || path.includes("\\") || path.includes("\0")) {
		return false;
	}
	if (path === MODEL_MANIFEST_PATH) {
		return true;
	}
	if (!path.startsWith(`${MODEL_DIR}/`)) {
		return false;
	}
	const name = path.slice(MODEL_DIR.length + 1);
	if (name.includes("/")) {
		return false;
	}
	return PART_FILE.test(name);
}

export function modelPartRepoPath(file: string): string {
	const path = `${MODEL_DIR}/${file}`;
	if (!isModelRepoPath(path) || !path.endsWith(".glb")) {
		throw new ModelManifestError("part file is not a glb");
	}
	return path;
}

export function parseModelManifest(input: unknown): ModelManifest {
	if (typeof input === "string") {
		try {
			input = JSON.parse(input) as unknown;
		} catch {
			throw new ModelManifestError("manifest is not valid JSON");
		}
	}
	if (!isRecord(input)) {
		throw new ModelManifestError("manifest must be an object");
	}
	rejectUnknown(input, MANIFEST_KEYS, "manifest");
	if (input.version !== 1) {
		throw new ModelManifestError("manifest version must be 1");
	}
	if (input.units !== MODEL_UNITS) {
		throw new ModelManifestError("manifest units must be mm");
	}
	if (input.tool !== MODEL_TOOL) {
		throw new ModelManifestError("manifest tool must be trimesh");
	}
	if (!Array.isArray(input.parts) || input.parts.length === 0) {
		throw new ModelManifestError("manifest needs parts");
	}
	const names = new Set<string>();
	const files = new Set<string>();
	const parts = input.parts.map((part, index) => {
		if (!isRecord(part)) {
			throw new ModelManifestError(`parts[${index}] must be an object`);
		}
		rejectUnknown(part, PART_KEYS, `parts[${index}]`);
		if (typeof part.name !== "string" || part.name.trim() !== part.name) {
			throw new ModelManifestError(`parts[${index}].name must be a string`);
		}
		if (
			part.name.length === 0 ||
			part.name.length > 80 ||
			/[\n\r\\/]/.test(part.name)
		) {
			throw new ModelManifestError(
				`parts[${index}].name must be a single line`,
			);
		}
		if (names.has(part.name)) {
			throw new ModelManifestError(`duplicate part name ${part.name}`);
		}
		names.add(part.name);
		if (typeof part.file !== "string" || !PART_FILE.test(part.file)) {
			throw new ModelManifestError(
				`parts[${index}].file must be one kebab-case .glb`,
			);
		}
		if (files.has(part.file)) {
			throw new ModelManifestError(`duplicate part file ${part.file}`);
		}
		files.add(part.file);
		if (part.units !== MODEL_UNITS) {
			throw new ModelManifestError(`parts[${index}].units must be mm`);
		}
		const parsed: ModelPart = {
			name: part.name,
			file: part.file,
			units: MODEL_UNITS,
			fits: parseFits(part.fits, index),
		};
		return parsed;
	});
	return {
		version: 1,
		units: MODEL_UNITS,
		tool: MODEL_TOOL,
		parts,
	};
}

export function base64DecodedSize(value: string): number {
	const clean = value.replace(/\s/g, "");
	if (clean.length === 0 || clean.length % 4 !== 0) {
		throw new ModelManifestError("model file is not base64");
	}
	const padding = clean.endsWith("==") ? 2 : clean.endsWith("=") ? 1 : 0;
	return Math.floor((clean.length * 3) / 4) - padding;
}

export function decodeModelBase64(value: string): Uint8Array {
	const clean = value.replace(/\s/g, "");
	const size = base64DecodedSize(clean);
	if (size > MODEL_FILE_MAX_BYTES) {
		throw new ModelManifestError("model file is too large");
	}
	const binary = atob(clean);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}

export function encodeModelBase64(bytes: Uint8Array): string {
	if (bytes.byteLength > MODEL_FILE_MAX_BYTES) {
		throw new ModelManifestError("model file is too large");
	}
	let binary = "";
	const chunk = 0x8000;
	for (let index = 0; index < bytes.length; index += chunk) {
		binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
	}
	return btoa(binary);
}

export function modelEmbedUrl(
	origin: string,
	opts?: { locale?: string; theme?: string },
): string {
	const base = origin.replace(/\/+$/, "");
	const url = new URL(`${base}${MODEL_EMBED_PATH}`);
	if (opts?.locale === "en" || opts?.locale === "fr") {
		url.searchParams.set("locale", opts.locale);
	}
	if (opts?.theme === "dark" || opts?.theme === "light") {
		url.searchParams.set("theme", opts.theme);
	}
	return url.toString();
}

export function modelEmbedInjectSource(payload: ModelEmbedPayload): string {
	const json = JSON.stringify(payload).replace(/</g, "\\u003c");
	return `window.${MODEL_EMBED_PENDING_KEY}=${json};if(window.${MODEL_EMBED_BRIDGE_KEY}){window.${MODEL_EMBED_BRIDGE_KEY}(window.${MODEL_EMBED_PENDING_KEY});}true;`;
}

export function parseModelEmbedMessage(
	data: unknown,
): ModelEmbedPayload | null {
	const record = asRecord(data);
	if (!record || record.type !== MODEL_EMBED_MESSAGE_TYPE) {
		return null;
	}
	return {
		type: MODEL_EMBED_MESSAGE_TYPE,
		glbBase64: asOptionalString(record.glbBase64),
	};
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

function rejectUnknown(
	record: Record<string, unknown>,
	allowed: readonly string[],
	label: string,
): void {
	for (const key of Object.keys(record)) {
		if (!allowed.includes(key)) {
			throw new ModelManifestError(`${label} has unknown field ${key}`);
		}
	}
}

function parseFits(value: unknown, index: number): ModelFit[] {
	if (!Array.isArray(value) || value.length === 0) {
		throw new ModelManifestError(`parts[${index}].fits must list a board`);
	}
	const fits: ModelFit[] = [];
	for (const item of value) {
		if (
			typeof item !== "string" ||
			!MODEL_FITS.includes(item as ModelFit) ||
			fits.includes(item as ModelFit)
		) {
			throw new ModelManifestError(
				`parts[${index}].fits must be companion-header and/or arduino-uno, arduino-nano, arduino-mega`,
			);
		}
		fits.push(item as ModelFit);
	}
	return fits;
}

function asRecord(data: unknown): Record<string, unknown> | null {
	if (typeof data === "string") {
		try {
			data = JSON.parse(data) as unknown;
		} catch {
			return null;
		}
	}
	if (!isRecord(data)) {
		return null;
	}
	return data;
}

function asOptionalString(value: unknown): string | null | undefined {
	if (value == null) {
		return value;
	}
	return typeof value === "string" ? value : undefined;
}
