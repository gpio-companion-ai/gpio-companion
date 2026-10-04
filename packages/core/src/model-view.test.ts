import { describe, expect, test } from "bun:test";
import {
	decodeModelBase64,
	encodeModelBase64,
	isModelRepoPath,
	MODEL_EMBED_MESSAGE_TYPE,
	MODEL_EMBED_PATH,
	MODEL_FILE_MAX_BYTES,
	ModelManifestError,
	modelEmbedInjectSource,
	modelEmbedUrl,
	modelPartRepoPath,
	parseModelEmbedMessage,
	parseModelManifest,
} from "./model-view.ts";

const sample = {
	version: 1,
	units: "mm",
	tool: "trimesh",
	parts: [
		{
			name: "header-clip",
			file: "header-clip.glb",
			units: "mm",
			fits: ["companion-header"],
		},
	],
};

describe("model paths", () => {
	test("accepts manifest and kebab glb only", () => {
		expect(isModelRepoPath("model/manifest.json")).toBe(true);
		expect(isModelRepoPath("model/header-clip.glb")).toBe(true);
		expect(isModelRepoPath("model/foo.stl")).toBe(false);
		expect(isModelRepoPath("model/Foo.glb")).toBe(false);
		expect(isModelRepoPath("model/../x.glb")).toBe(false);
		expect(isModelRepoPath("pcb/circuit.json")).toBe(false);
		expect(modelPartRepoPath("header-clip.glb")).toBe("model/header-clip.glb");
		expect(() => modelPartRepoPath("model/header-clip.glb")).toThrow(
			ModelManifestError,
		);
	});
});

describe("parseModelManifest", () => {
	test("accepts a version 1 manifest", () => {
		const manifest = parseModelManifest(JSON.stringify(sample));
		expect(manifest.parts[0]?.file).toBe("header-clip.glb");
		expect(manifest.parts[0]?.fits).toEqual(["companion-header"]);
	});

	test("rejects junk", () => {
		expect(() => parseModelManifest("{")).toThrow(ModelManifestError);
		expect(() => parseModelManifest({ version: 2 })).toThrow(
			ModelManifestError,
		);
		expect(() =>
			parseModelManifest({
				...sample,
				parts: [{ ...sample.parts[0], fits: [] }],
			}),
		).toThrow(ModelManifestError);
	});
});

describe("model base64", () => {
	test("round-trips bytes under the cap", () => {
		const bytes = new Uint8Array([0, 1, 255, 10]);
		expect(decodeModelBase64(encodeModelBase64(bytes))).toEqual(bytes);
	});

	test("rejects an oversized payload", () => {
		expect(() =>
			encodeModelBase64(new Uint8Array(MODEL_FILE_MAX_BYTES + 1)),
		).toThrow(ModelManifestError);
	});
});

describe("model embed", () => {
	test("builds the dashboard embed origin", () => {
		expect(
			modelEmbedUrl("https://gpio-companion.com/", {
				locale: "fr",
				theme: "dark",
			}),
		).toBe(
			`https://gpio-companion.com${MODEL_EMBED_PATH}?locale=fr&theme=dark`,
		);
	});

	test("parses a posted glb", () => {
		const payload = {
			type: MODEL_EMBED_MESSAGE_TYPE,
			glbBase64: "AAAA",
		} as const;
		expect(parseModelEmbedMessage(JSON.stringify(payload))).toEqual(payload);
		expect(parseModelEmbedMessage({ type: "other" })).toBeNull();
		const script = modelEmbedInjectSource(payload);
		expect(script).toContain("window.__gpioModelPending");
		expect(script.endsWith("true;")).toBe(true);
	});
});
