import { FIRMWARE_SKETCH_DIR, HOST_SKETCH_DIR } from "./project-files.ts";

export type BoardSketchKind = "host" | "firmware";

export type BoardSketch = {
	project: string;
	name: string;
	dir: string;
	files: string[];
	target?: "header" | "arduino-proxy";
};

export type BoardSketchList = {
	sketches: BoardSketch[];
};

export function sketchKindDir(kind: BoardSketchKind): string {
	return kind === "host" ? HOST_SKETCH_DIR : FIRMWARE_SKETCH_DIR;
}

const SKETCH_SOURCE_EXT = [".c", ".ino"];

export function sketchNameFromPath(
	kind: BoardSketchKind,
	path: string,
): string | null {
	const prefix = `${sketchKindDir(kind)}/`;
	if (!path.startsWith(prefix)) {
		return null;
	}
	const rest = path.slice(prefix.length);
	const segments = rest.split("/");
	const base = segments[segments.length - 1];
	if (!base || !SKETCH_SOURCE_EXT.some((ext) => base.endsWith(ext))) {
		return null;
	}
	if (segments.length === 1) {
		return sketchKindDir(kind);
	}
	const name = segments[0];
	if (!name || name.startsWith(".") || name.includes("\\")) {
		return null;
	}
	return name;
}

export function findSketchByName(
	sketches: BoardSketch[],
	project: string,
	name: string,
): BoardSketch | null {
	return (
		sketches.find(
			(sketch) => sketch.project === project && sketch.name === name,
		) ?? null
	);
}

export function parseBoardSketchList(input: unknown): BoardSketchList {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error("sketches must be an object");
	}
	const sketches = (input as { sketches?: unknown }).sketches;
	if (!Array.isArray(sketches)) {
		throw new Error("sketches is required");
	}
	return {
		sketches: sketches.map((item, index) => parseBoardSketch(item, index)),
	};
}

function parseBoardSketch(input: unknown, index: number): BoardSketch {
	if (input === null || typeof input !== "object" || Array.isArray(input)) {
		throw new Error(`sketch ${index} must be an object`);
	}
	const record = input as Record<string, unknown>;
	const project = requiredName(record.project, "project");
	const name = requiredName(record.name, "name");
	const dir = requiredDir(record.dir);
	const filesRaw = record.files;
	if (
		!Array.isArray(filesRaw) ||
		filesRaw.some((file) => typeof file !== "string")
	) {
		throw new Error("files is required");
	}
	const sketch: BoardSketch = {
		project,
		name,
		dir,
		files: filesRaw.filter((file) => file.trim().length > 0),
	};
	if (record.target === "header" || record.target === "arduino-proxy") {
		sketch.target = record.target;
	} else if (name.startsWith("arduino-proxy-")) {
		sketch.target = "arduino-proxy";
	}
	return sketch;
}

function requiredName(value: unknown, field: string): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error(`${field} is required`);
	}
	const name = value.trim();
	if (name.includes("/") || name.includes("\\") || name.includes("..")) {
		throw new Error(`${field} is invalid`);
	}
	return name;
}

function requiredDir(value: unknown): string {
	if (typeof value !== "string" || value.trim().length === 0) {
		throw new Error("dir is required");
	}
	const dir = value.trim();
	if (!dir.startsWith("/") || dir.includes("..")) {
		throw new Error("dir must be an absolute path");
	}
	return dir;
}
