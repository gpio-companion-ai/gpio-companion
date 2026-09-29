import {
	existsSync,
	type FSWatcher,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	watch,
	writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
	BOARD_FILE_DEPTH_MAX,
	BOARD_FILE_LIST_MAX,
	BOARD_FILE_MODEL_MAX,
	BOARD_FILE_SKIP_DIRS,
	BOARD_FILE_TEXT_MAX,
	type BoardFileEntry,
	type BoardFileEvent,
	type BoardFileKind,
	type BoardFileList,
	type BoardFileRead,
	type BoardFileWrite,
	boardFileKindFromName,
	boardFileRelative,
	isUtf8Text,
	parseGithubRepoName,
} from "gpio-companion";

const SKIP = new Set<string>(BOARD_FILE_SKIP_DIRS);

export type BoardFileSocket = {
	send(data: string): void;
};

export type BoardFileHub = {
	add(socket: BoardFileSocket, repo: string): void;
	remove(socket: BoardFileSocket): void;
	stop(): void;
};

export async function listBoardFiles(
	root: string,
	name: string,
): Promise<BoardFileList> {
	const project = projectDir(root, name);
	if (!existsSync(project)) {
		throw new Error("project is not on this board");
	}
	const entries: BoardFileEntry[] = [];
	walk(project, project, entries, 0);
	entries.sort((a, b) => a.path.localeCompare(b.path));
	return { branch: await gitBranch(project), entries };
}

export async function readBoardFile(
	root: string,
	name: string,
	path: string,
): Promise<BoardFileRead> {
	const target = confinedFile(root, name, path);
	if (!existsSync(target) || !lstatSync(target).isFile()) {
		throw new Error("file not found");
	}
	const rel = boardFileRelative(path);
	const named = boardFileKindFromName(rel);
	const bytes = readFileSync(target);
	if (named === "model") {
		if (bytes.byteLength > BOARD_FILE_MODEL_MAX) {
			throw new Error("file is too large");
		}
		return {
			path: rel,
			kind: "model",
			base64: Buffer.from(bytes).toString("base64"),
		};
	}
	if (named === "binary" || !isUtf8Text(bytes)) {
		return { path: rel, kind: "binary" };
	}
	if (bytes.byteLength > BOARD_FILE_TEXT_MAX) {
		throw new Error("file is too large");
	}
	return {
		path: rel,
		kind: "text",
		text: bytes.toString("utf8"),
	};
}

export async function writeBoardFile(
	root: string,
	name: string,
	path: string,
	text: string,
): Promise<BoardFileWrite> {
	const rel = boardFileRelative(path);
	const kind = boardFileKindFromName(rel);
	if (kind === "model" || kind === "binary") {
		throw new Error("file is not text");
	}
	if (Buffer.byteLength(text) > BOARD_FILE_TEXT_MAX) {
		throw new Error("file is too large");
	}
	const target = confinedFile(root, name, rel);
	mkdirSync(dirname(target), { recursive: true });
	const tmp = `${target}.gpio-tmp`;
	writeFileSync(tmp, text);
	renameSync(tmp, target);
	return { written: true, path: rel };
}

export function createBoardFileHub(root: string): BoardFileHub {
	const sockets = new Map<BoardFileSocket, string>();
	const watchers = new Map<string, FSWatcher>();
	const counts = new Map<string, number>();
	const timers = new Map<string, ReturnType<typeof setTimeout>>();

	function publish(repo: string, event: BoardFileEvent) {
		const body = JSON.stringify(event);
		for (const [socket, name] of sockets) {
			if (name !== repo) {
				continue;
			}
			try {
				socket.send(body);
			} catch {
				sockets.delete(socket);
			}
		}
	}

	function ensureWatch(repo: string) {
		if (watchers.has(repo)) {
			return;
		}
		const dir = projectDir(root, repo);
		if (!existsSync(dir)) {
			return;
		}
		const watcher = watch(dir, { recursive: true }, (event, filename) => {
			const rel = String(filename ?? "")
				.replace(/\\/g, "/")
				.replace(/^\.?\//, "");
			if (!rel || rel.split("/").some((part) => SKIP.has(part))) {
				return;
			}
			const key = `${repo}\0${rel}`;
			const prev = timers.get(key);
			if (prev) {
				clearTimeout(prev);
			}
			timers.set(
				key,
				setTimeout(() => {
					timers.delete(key);
					const full = join(dir, rel);
					const kind =
						event === "rename" && !existsSync(full)
							? "unlink"
							: event === "rename"
								? "add"
								: "change";
					publish(repo, { repo, path: rel, kind });
				}, 150),
			);
		});
		watchers.set(repo, watcher);
	}

	return {
		add(socket, repo) {
			const name = parseGithubRepoName(repo);
			sockets.set(socket, name);
			counts.set(name, (counts.get(name) ?? 0) + 1);
			ensureWatch(name);
		},
		remove(socket) {
			const name = sockets.get(socket);
			sockets.delete(socket);
			if (!name) {
				return;
			}
			const next = (counts.get(name) ?? 1) - 1;
			if (next > 0) {
				counts.set(name, next);
				return;
			}
			counts.delete(name);
			watchers.get(name)?.close();
			watchers.delete(name);
		},
		stop() {
			for (const watcher of watchers.values()) {
				watcher.close();
			}
			watchers.clear();
			for (const timer of timers.values()) {
				clearTimeout(timer);
			}
			timers.clear();
			sockets.clear();
			counts.clear();
		},
	};
}

function projectDir(root: string, name: string): string {
	const repo = parseGithubRepoName(name);
	const base = resolve(root);
	const dest = resolve(base, repo);
	if (dest !== base && !dest.startsWith(`${base}${sep}`)) {
		throw new Error("invalid path");
	}
	return dest;
}

function confinedFile(root: string, name: string, path: string): string {
	const rel = boardFileRelative(path);
	const project = projectDir(root, name);
	const target = resolve(project, rel);
	if (!target.startsWith(`${project}${sep}`)) {
		throw new Error("invalid path");
	}
	const realProject = existsSync(project) ? realpathSync(project) : project;
	if (existsSync(target)) {
		if (lstatSync(target).isSymbolicLink()) {
			throw new Error("invalid path");
		}
		const real = realpathSync(target);
		if (real !== realProject && !real.startsWith(`${realProject}${sep}`)) {
			throw new Error("invalid path");
		}
	}
	const parent = dirname(target);
	if (existsSync(parent)) {
		const realParent = realpathSync(parent);
		if (
			realParent !== realProject &&
			!realParent.startsWith(`${realProject}${sep}`)
		) {
			throw new Error("invalid path");
		}
	}
	return target;
}

function walk(
	project: string,
	dir: string,
	entries: BoardFileEntry[],
	depth: number,
): void {
	if (depth > BOARD_FILE_DEPTH_MAX || entries.length >= BOARD_FILE_LIST_MAX) {
		return;
	}
	let names: string[] = [];
	try {
		names = readdirSync(dir);
	} catch {
		return;
	}
	names.sort();
	for (const name of names) {
		if (entries.length >= BOARD_FILE_LIST_MAX || SKIP.has(name)) {
			continue;
		}
		const full = join(dir, name);
		let stat: ReturnType<typeof lstatSync>;
		try {
			stat = lstatSync(full);
		} catch {
			continue;
		}
		if (stat.isSymbolicLink()) {
			continue;
		}
		const rel = relative(project, full).split(sep).join("/");
		if (stat.isDirectory()) {
			entries.push({ path: rel, type: "dir", size: 0 });
			walk(project, full, entries, depth + 1);
			continue;
		}
		if (stat.isFile()) {
			entries.push({ path: rel, type: "file", size: stat.size });
		}
	}
}

async function gitBranch(dir: string): Promise<string> {
	try {
		const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], {
			cwd: dir,
			stdout: "pipe",
			stderr: "pipe",
		});
		const [stdout, code] = await Promise.all([
			new Response(proc.stdout).text(),
			proc.exited,
		]);
		if (code !== 0) {
			return "";
		}
		return stdout.trim();
	} catch {
		return "";
	}
}

export function boardReadKind(path: string, bytes: Uint8Array): BoardFileKind {
	const named = boardFileKindFromName(path);
	if (named === "model" || named === "binary") {
		return named;
	}
	return isUtf8Text(bytes) ? "text" : "binary";
}
