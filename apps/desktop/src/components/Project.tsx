import Alert from "@shpaw415/mui-lite/Alert";
import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Table, {
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	type CircuitVerifyItem,
	circuitVerifyOverlay,
	type ModelPart,
	modelPartRepoPath,
	parseModelManifest,
	parseWokwiDiagram,
} from "gpio-companion";
import { translateError } from "gpio-companion-i18n";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	type BoardSketch,
	createProject,
	deleteProject,
	type GithubContent,
	type GithubRepo,
	type GpioTarget,
	getGithubApp,
	listProjects,
	loadProject,
	loadRun,
	loadRunSketches,
	openExternal,
	type ProjectBundle,
	pushProject,
	type RunStatus,
	readProjectFile,
	startRun,
	stopRun,
} from "../api";
import {
	CACHE_KEYS,
	useApiCache,
	useCachedQuery,
	useUserBoards,
} from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { useDeviceHub } from "../hooks/useDeviceHub";
import { useT } from "../locale";
import BreadboardViewer from "./BreadboardViewer";
import DebugLog from "./DebugLog";
import FlashPanel from "./FlashPanel";
import GpioPanel from "./GpioPanel";
import JlcpcbCard from "./JlcpcbCard";
import ModelViewer from "./ModelViewer";
import RunPanel from "./RunPanel";
import { ListSkeleton, PreviewSkeleton } from "./skeletons";
import VerifyPanel from "./VerifyPanel";

const LAST_REPO_KEY = "gpio-companion-selected-project";

type BoardTool = "gpio" | "flash" | "run" | "verify";

function ToolSection({
	title,
	hint,
	open,
	onToggle,
	children,
}: {
	title: string;
	hint: string;
	open: boolean;
	onToggle: () => void;
	children: ReactNode;
}) {
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		if (open) {
			setSeen(true);
		}
	}, [open]);
	return (
		<Box
			className={`board-tool ${open ? "is-open" : ""}`}
			sx={{ minWidth: 0, overflow: "hidden" }}
		>
			<button
				type="button"
				className="board-tool-summary"
				onClick={onToggle}
				aria-expanded={open}
			>
				<span className="board-tool-copy">
					<Typography variant="subtitle2">{title}</Typography>
					{open ? null : (
						<Typography variant="caption" color="secondary">
							{hint}
						</Typography>
					)}
				</span>
				<span className="board-tool-chevron" aria-hidden="true">
					{open ? "▾" : "▸"}
				</span>
			</button>
			{seen ? (
				<Box sx={open ? { p: 1.5, minWidth: 0 } : { display: "none" }}>
					{children}
				</Box>
			) : null}
		</Box>
	);
}

function lastRepoKey(repo: GithubRepo) {
	return `${repo.owner}/${repo.name}`;
}

function bundleReady(bundle: ProjectBundle): boolean {
	return Boolean(bundle.ref && bundle.branches);
}

function rememberProjectBundle(
	cache: { set: (key: string, value: ProjectBundle) => void },
	next: ProjectBundle,
) {
	cache.set(CACHE_KEYS.projectBundle(next.owner, next.repo), next);
	if (next.ref) {
		cache.set(CACHE_KEYS.projectBundle(next.owner, next.repo, next.ref), next);
	}
}

function PreviewCard({
	title,
	hint,
	url,
}: {
	title: string;
	hint: string;
	url: string | null;
}) {
	const t = useT();
	return (
		<Paper sx={{ overflow: "hidden", minHeight: 220 }} elevation={1}>
			{url ? (
				<img
					src={url}
					alt={t("project.pcbPreviewAlt")}
					style={{
						display: "block",
						width: "100%",
						maxHeight: 360,
						objectFit: "contain",
						background: "#fff",
					}}
				/>
			) : (
				<Stack
					sx={{
						minHeight: 220,
						alignItems: "center",
						justifyContent: "center",
						px: 3,
					}}
				>
					<Typography color="secondary" align="center">
						{hint}
					</Typography>
				</Stack>
			)}
			<Typography color="secondary" sx={{ px: 2, py: 1.5 }}>
				{title}
			</Typography>
		</Paper>
	);
}

function BoardSketchGroup({
	title,
	action,
	sketches,
	busy,
	onLaunch,
}: {
	title: string;
	action: string;
	sketches: BoardSketch[];
	busy: boolean;
	onLaunch: (dir: string) => void;
}) {
	const t = useT();
	return (
		<Paper sx={{ p: 2 }} elevation={1}>
			<Typography variant="subtitle1" sx={{ mb: 1 }}>
				{title}
			</Typography>
			{sketches.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("project.noneOnBoard")}
				</Typography>
			) : (
				<Stack spacing={0.5}>
					{sketches.map((item) => (
						<Stack
							key={item.dir}
							direction="row"
							spacing={1}
							sx={{ alignItems: "center", justifyContent: "space-between" }}
						>
							<Typography variant="body2">{item.name}</Typography>
							<Button
								variant="outlined"
								size="small"
								disabled={busy}
								onClick={() => onLaunch(item.dir)}
							>
								{action}
							</Button>
						</Stack>
					))}
				</Stack>
			)}
		</Paper>
	);
}

function FileGroup({
	title,
	files,
}: {
	title: string;
	files: GithubContent[];
}) {
	const t = useT();
	return (
		<Paper sx={{ p: 2 }} elevation={1}>
			<Stack direction="row" spacing={1} sx={{ alignItems: "center", mb: 1 }}>
				<Typography variant="subtitle1">{title}</Typography>
				<Chip label={`${files.length}`} size="small" variant="outlined" />
			</Stack>
			{files.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("project.emptyFolder")}
				</Typography>
			) : (
				<Stack spacing={0.5}>
					{files.map((file) =>
						file.download_url ? (
							<Button
								key={file.path}
								variant="text"
								size="small"
								sx={{ justifyContent: "flex-start", wordBreak: "break-all" }}
								onClick={() => void openExternal(file.download_url ?? "")}
							>
								{file.path}
							</Button>
						) : (
							<Typography key={file.path} variant="body2" color="secondary">
								{file.path}
							</Typography>
						),
					)}
				</Stack>
			)}
		</Paper>
	);
}

export default function Project({
	onOpenProfile,
}: {
	onOpenProfile?: () => void;
}) {
	const t = useT();
	const { cache } = useApiCache();
	const githubQuery = useCachedQuery(CACHE_KEYS.githubApp, getGithubApp);
	const projectsQuery = useCachedQuery(CACHE_KEYS.projects, listProjects);
	const { boards, paired, refetch } = useUserBoards();
	const {
		uuid: selectedUuid,
		setUuid: selectBoard,
		openCode,
	} = useBoardSelection();
	const app = githubQuery.data ?? null;
	const repos = projectsQuery.data?.repos ?? [];
	const configured = projectsQuery.data?.configured ?? false;
	const loading = githubQuery.loading || projectsQuery.loading;
	const [bundle, setBundle] = useState<ProjectBundle | null>(() => {
		try {
			const stored = window.localStorage.getItem(LAST_REPO_KEY) ?? "";
			if (!stored) {
				return null;
			}
			const slash = stored.indexOf("/");
			if (slash <= 0) {
				return null;
			}
			const hit = cache.peek<ProjectBundle>(
				CACHE_KEYS.projectBundle(
					stored.slice(0, slash),
					stored.slice(slash + 1),
				),
			);
			return hit.hit && bundleReady(hit.value) ? hit.value : null;
		} catch {
			return null;
		}
	});
	const [error, setError] = useState("");
	const [opening, setOpening] = useState(false);
	const [query, setQuery] = useState("");
	const [owner, setOwner] = useState("all");
	const [createName, setCreateName] = useState("");
	const [creating, setCreating] = useState(false);
	const [justCreated, setJustCreated] = useState("");
	const [toolState, setToolState] = useState<{
		key: string;
		tool: BoardTool | null;
	}>({ key: "", tool: null });
	const [saving, setSaving] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [saveHint, setSaveHint] = useState("");
	const [stopping, setStopping] = useState(false);
	const [runRunning, setRunRunning] = useState(false);
	const [breadboardJson, setBreadboardJson] = useState<string | null>(null);
	const [modelParts, setModelParts] = useState<ModelPart[]>([]);
	const [activePart, setActivePart] = useState<string | null>(null);
	const [modelGlb, setModelGlb] = useState<string | null>(null);
	const modelToken = useRef(0);
	const [livePins, setLivePins] = useState<Record<number, 0 | 1>>({});
	const [arduinoLivePins, setArduinoLivePins] = useState<Record<number, 0 | 1>>(
		{},
	);
	const [verifyResults, setVerifyResults] = useState<CircuitVerifyItem[]>([]);
	const [hostSketches, setHostSketches] = useState<BoardSketch[]>([]);
	const { isEasy } = useDashboardMode();
	const [sketchBusy, setSketchBusy] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteName, setDeleteName] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<{
		owner: string;
		name: string;
	} | null>(null);
	const activeBoard =
		boards.find((board) => board.device.uuid === selectedUuid) ?? boards[0];
	const activeUuid = activeBoard?.device.uuid ?? "";
	const overlay = useMemo(() => {
		if (!breadboardJson || !verifyResults.length) {
			return undefined;
		}
		try {
			return circuitVerifyOverlay(
				parseWokwiDiagram(breadboardJson),
				verifyResults,
			);
		} catch {
			return undefined;
		}
	}, [breadboardJson, verifyResults]);

	useEffect(() => {
		if (!bundle) {
			setBreadboardJson(null);
			return;
		}
		const hasDiagram = bundle.breadboard.some(
			(file) =>
				file.name === "diagram.json" || file.path.endsWith("/diagram.json"),
		);
		const path = bundle.breadboardDiagramUrl
			? "breadboard/diagram.json"
			: bundle.breadboardCircuitJsonUrl
				? "breadboard/circuit.json"
				: hasDiagram
					? "breadboard/diagram.json"
					: null;
		if (!path) {
			setBreadboardJson(null);
			return;
		}
		let cancelled = false;
		void readProjectFile(bundle.owner, bundle.repo, path, bundle.ref)
			.then((file) => {
				if (!cancelled) {
					setBreadboardJson(file.text);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setBreadboardJson(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [bundle]);

	useEffect(() => {
		if (!bundle) {
			setModelParts([]);
			setActivePart(null);
			setModelGlb(null);
			return;
		}
		const listed = bundle.model ?? [];
		const hasManifest =
			Boolean(bundle.modelManifestUrl) ||
			listed.some(
				(file) =>
					file.name === "manifest.json" || file.path === "model/manifest.json",
			);
		if (bundle.model && !hasManifest) {
			setModelParts([]);
			setActivePart(null);
			setModelGlb(null);
			return;
		}
		const token = ++modelToken.current;
		let cancelled = false;
		setModelParts([]);
		setActivePart(null);
		setModelGlb(null);
		void readProjectFile(
			bundle.owner,
			bundle.repo,
			"model/manifest.json",
			bundle.ref,
		)
			.then(async (file) => {
				if (cancelled || modelToken.current !== token) {
					return;
				}
				const manifest = parseModelManifest(file.text);
				const part = manifest.parts[0];
				setModelParts(manifest.parts);
				if (!part) {
					return;
				}
				setActivePart(part.name);
				const glb = await readProjectFile(
					bundle.owner,
					bundle.repo,
					modelPartRepoPath(part.file),
					bundle.ref,
				);
				if (!cancelled && modelToken.current === token) {
					setModelGlb(glb.base64 || null);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setModelParts([]);
					setActivePart(null);
					setModelGlb(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [bundle]);

	function selectModelPart(name: string) {
		if (!bundle) {
			return;
		}
		const part = modelParts.find((item) => item.name === name);
		if (!part) {
			return;
		}
		const token = ++modelToken.current;
		setActivePart(name);
		setModelGlb(null);
		void readProjectFile(
			bundle.owner,
			bundle.repo,
			modelPartRepoPath(part.file),
			bundle.ref,
		)
			.then((file) => {
				if (modelToken.current === token) {
					setModelGlb(file.base64 || null);
				}
			})
			.catch(() => {
				if (modelToken.current === token) {
					setModelGlb(null);
				}
			});
	}

	useEffect(() => {
		void listProjects()
			.then((projects) => {
				projectsQuery.setData(projects);
			})
			.catch(() => undefined);
	}, [projectsQuery.setData]);

	useEffect(() => {
		if ((app?.connected && app.canCreate) || loading) {
			return;
		}
		const timer = window.setInterval(() => {
			void Promise.all([getGithubApp(), listProjects()])
				.then(([github, projects]) => {
					githubQuery.setData(github);
					projectsQuery.setData(projects);
				})
				.catch(() => undefined);
		}, 2500);
		return () => window.clearInterval(timer);
	}, [
		app?.canCreate,
		app?.connected,
		loading,
		githubQuery.setData,
		projectsQuery.setData,
	]);

	const owners = useMemo(
		() => [...new Set(repos.map((repo) => repo.owner))].sort(),
		[repos],
	);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		return repos.filter((repo) => {
			if (owner !== "all" && repo.owner !== owner) {
				return false;
			}
			if (!needle) {
				return true;
			}
			return (
				repo.name.toLowerCase().includes(needle) ||
				repo.full_name.toLowerCase().includes(needle)
			);
		});
	}, [repos, owner, query]);

	async function makeProject() {
		const name = createName.trim();
		if (!name || creating) {
			return;
		}
		setError("");
		setCreating(true);
		try {
			const repo = await createProject(name);
			projectsQuery.setData((current) => ({
				configured: true,
				repos: [repo, ...(current?.repos ?? [])],
			}));
			setCreateName("");
			setJustCreated(repo.name);
			await openRepo(repo, true);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to create project",
			);
		} finally {
			setCreating(false);
		}
	}

	function openDelete(owner: string, name: string) {
		setPendingDelete({ owner, name });
		setDeleteName("");
		setDeleteOpen(true);
	}

	async function removeOpenedProject() {
		if (!pendingDelete || deleting) {
			return;
		}
		if (deleteName.trim() !== pendingDelete.name) {
			return;
		}
		setError("");
		setDeleting(true);
		try {
			await deleteProject(pendingDelete.owner, pendingDelete.name);
			projectsQuery.setData((current) => ({
				configured: current?.configured ?? true,
				repos: (current?.repos ?? []).filter(
					(item) =>
						!(
							item.owner === pendingDelete.owner &&
							item.name === pendingDelete.name
						),
				),
			}));
			if (
				bundle?.owner === pendingDelete.owner &&
				bundle.repo === pendingDelete.name
			) {
				setBundle(null);
				try {
					window.localStorage.removeItem(LAST_REPO_KEY);
				} catch {
					undefined;
				}
			}
			setJustCreated("");
			setSaveHint("");
			setDeleteOpen(false);
			setDeleteName("");
			setPendingDelete(null);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to delete project",
			);
		} finally {
			setDeleting(false);
		}
	}

	async function stopSketch() {
		if (!activeUuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			await stopRun(activeUuid);
			setRunRunning((await loadRun(activeUuid)).running);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to stop sketch",
			);
		} finally {
			setStopping(false);
		}
	}

	async function saveFromBoard() {
		if (!bundle || !activeUuid || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setSaving(true);
		try {
			const result = await pushProject({
				uuid: activeUuid,
				owner: bundle.owner,
				name: bundle.repo,
			});
			rememberProjectBundle(cache, result.bundle);
			setBundle(result.bundle);
			setSaveHint(
				result.board.committed
					? t("project.savedPushed")
					: t("project.alreadyUpToDate"),
			);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to save project",
			);
		} finally {
			setSaving(false);
		}
	}

	async function selectBranch(ref: string) {
		if (!bundle || !ref || ref === bundle.ref || opening || reloading) {
			return;
		}
		setError("");
		setSaveHint("");
		const key = CACHE_KEYS.projectBundle(bundle.owner, bundle.repo, ref);
		const hit = cache.peek<ProjectBundle>(key);
		if (hit.hit && bundleReady(hit.value)) {
			setBundle(hit.value);
			return;
		}
		setOpening(true);
		try {
			const next = await cache.get(key, () =>
				loadProject(bundle.owner, bundle.repo, ref),
			);
			setBundle(next);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to load branch",
			);
		} finally {
			setOpening(false);
		}
	}

	const reloadBundle = useCallback(async () => {
		if (!bundle || opening || reloading || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setReloading(true);
		try {
			const next = await cache.get(
				CACHE_KEYS.projectBundle(bundle.owner, bundle.repo),
				() => loadProject(bundle.owner, bundle.repo),
				true,
			);
			rememberProjectBundle(cache, next);
			setBundle(next);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to load project",
			);
		} finally {
			setReloading(false);
		}
	}, [bundle, cache, opening, reloading, saving]);

	const reloadRef = useRef(reloadBundle);
	reloadRef.current = reloadBundle;

	useEffect(() => {
		function onVisible() {
			if (document.visibilityState === "hidden") {
				return;
			}
			void reloadRef.current();
		}
		void reloadRef.current();
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, []);

	async function openRepo(repo: GithubRepo, created = false) {
		if (!created) {
			setJustCreated("");
		}
		setError("");
		setSaveHint("");
		const key = CACHE_KEYS.projectBundle(repo.owner, repo.name);
		const hit = cache.peek<ProjectBundle>(key);
		if (hit.hit && bundleReady(hit.value)) {
			setBundle(hit.value);
			try {
				window.localStorage.setItem(LAST_REPO_KEY, lastRepoKey(repo));
			} catch {
				// ignore
			}
			void cache
				.get(key, () => loadProject(repo.owner, repo.name), true)
				.then((next) => {
					rememberProjectBundle(cache, next);
					setBundle(next);
				})
				.catch(() => undefined);
			return;
		}
		setOpening(true);
		try {
			const next = await cache.get(
				key,
				() => loadProject(repo.owner, repo.name),
				hit.hit,
			);
			rememberProjectBundle(cache, next);
			setBundle(next);
			try {
				window.localStorage.setItem(LAST_REPO_KEY, lastRepoKey(repo));
			} catch {
				return;
			}
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to load project",
			);
		} finally {
			setOpening(false);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: open last/first repo once the list is ready
	useEffect(() => {
		if (loading || bundle || repos.length === 0) {
			return;
		}
		let stored = "";
		try {
			stored = window.localStorage.getItem(LAST_REPO_KEY) ?? "";
		} catch {
			stored = "";
		}
		const match =
			repos.find((repo) => lastRepoKey(repo) === stored) ?? repos[0];
		if (match) {
			void openRepo(match);
		}
		// open the last (or first) repo once the list is ready
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loading, repos]);

	const selectedKey = bundle ? `${bundle.owner}/${bundle.repo}` : "";
	const empty = !loading && configured && repos.length === 0;
	const canCreate = app?.canCreate !== false;

	const openTool = toolState.key === selectedKey ? toolState.tool : null;
	function toggleTool(tool: BoardTool) {
		setToolState((current) => {
			const active = current.key === selectedKey ? current.tool : null;
			return {
				key: selectedKey,
				tool: active === tool ? null : tool,
			};
		});
	}

	function openAgent() {
		if (!activeUuid) {
			return;
		}
		openCode();
	}

	useEffect(() => {
		if (!activeUuid) {
			setHostSketches([]);
			setRunRunning(false);
			return;
		}
		let cancelled = false;
		loadRunSketches(activeUuid)
			.then((host) => {
				if (cancelled) {
					return;
				}
				setHostSketches(host.sketches);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setHostSketches([]);
			});
		loadRun(activeUuid)
			.then((status) => {
				if (!cancelled) {
					setRunRunning(status.running);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setRunRunning(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [activeUuid]);

	const onRun = useCallback((next: RunStatus) => {
		setRunRunning(next.running);
	}, []);
	useDeviceHub(activeUuid, { onRun });

	function launchSketch(task: () => Promise<void>) {
		setSketchBusy(true);
		setError("");
		void task()
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => setSketchBusy(false));
	}

	return (
		<Stack spacing={1.5}>
			{paired && activeUuid ? (
				<Stack direction="row" sx={{ justifyContent: "flex-end" }}>
					<Button variant="outlined" size="small" onClick={openAgent}>
						{t("project.openCode")}
					</Button>
				</Stack>
			) : null}
			<JlcpcbCard onOpenProfile={onOpenProfile} />
			{error || githubQuery.error || projectsQuery.error ? (
				<Alert severity="error">
					{translateError(t, error || githubQuery.error || projectsQuery.error)}
				</Alert>
			) : null}
			{error || githubQuery.error || projectsQuery.error ? (
				<DebugLog
					error={translateError(
						t,
						error || githubQuery.error || projectsQuery.error,
					)}
				/>
			) : null}

			{loading ? <ListSkeleton items={4} /> : null}

			{loading || app?.connected ? null : (
				<Paper className="workbench-control-rail" sx={{ p: 2 }} elevation={0}>
					<Stack spacing={2}>
						<Typography variant="h6">
							{t("project.connectGithubNative")}
						</Typography>
						<Typography color="secondary">
							{t("project.connectGithubNativeHint")}
						</Typography>
						<Stack direction="row" spacing={1}>
							<Button
								variant="contained"
								disabled={!app?.installUrl}
								onClick={() => void openExternal(app?.installUrl ?? "")}
							>
								{t("github.connect")}
							</Button>
							{!paired ? (
								<Typography color="secondary" sx={{ alignSelf: "center" }}>
									{t("project.pairWhenReady")}
								</Typography>
							) : null}
						</Stack>
					</Stack>
				</Paper>
			)}

			{loading || !configured ? null : (
				<Paper
					className="workbench-control-rail"
					sx={{ p: 2, width: "86%", margin: "0 auto" }}
					elevation={0}
				>
					<Stack spacing={2}>
						{canCreate ? (
							<Stack spacing={empty ? 1 : 2}>
								{empty ? (
									<>
										<Typography variant="h6">
											{t("project.createFirst")}
										</Typography>
										<Typography color="secondary">
											{t("project.createHint")}
										</Typography>
									</>
								) : null}
								<Stack
									direction="row"
									spacing={2}
									sx={{ flexWrap: "wrap", alignItems: "flex-end" }}
								>
									<TextField
										label={t("project.newProject")}
										placeholder={t("project.placeholderName")}
										value={createName}
										onChange={(event) => setCreateName(event.target.value)}
										onKeyDown={(event) => {
											if (event.key === "Enter") {
												event.preventDefault();
												void makeProject();
											}
										}}
										sx={{ flex: 1, minWidth: 180 }}
									/>
									<Button
										variant="contained"
										disabled={creating || !createName.trim()}
										onClick={() => void makeProject()}
									>
										{creating ? t("project.creating") : t("project.create")}
									</Button>
								</Stack>
							</Stack>
						) : (
							<Stack spacing={2}>
								{empty ? (
									<Typography variant="h6">
										{t("project.createFirst")}
									</Typography>
								) : null}
								<Alert severity="info">{t("project.authorizeHint")}</Alert>
								<Button
									variant="contained"
									disabled={!app?.installUrl}
									onClick={() => void openExternal(app?.installUrl ?? "")}
								>
									{t("project.authorizeRepos")}
								</Button>
							</Stack>
						)}
						{empty ? null : (
							<>
								<Stack
									direction="row"
									spacing={2}
									sx={{ flexWrap: "wrap", alignItems: "flex-end" }}
								>
									<TextField
										label={t("project.filter")}
										placeholder={t("project.filterPlaceholder")}
										value={query}
										onChange={(event) => setQuery(event.target.value)}
										sx={{ flex: 1, minWidth: 220 }}
									/>
									<Select
										name="owner"
										label={t("project.owner")}
										value={owner}
										onSelect={setOwner}
										sx={{ minWidth: 180 }}
									>
										{[
											<option key="all" value="all">
												{t("project.allOwners")}
											</option>,
											...owners.map((login) => (
												<option key={login} value={login}>
													{login}
												</option>
											)),
										]}
									</Select>
								</Stack>
								<TableContainer>
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>{t("project.colName")}</TableCell>
												<TableCell>{t("project.colOwner")}</TableCell>
												<TableCell />
											</TableRow>
										</TableHead>
										<TableBody>
											{filtered.map((repo) => {
												const key = lastRepoKey(repo);
												return (
													<TableRow
														key={key}
														hover
														selected={selectedKey === key}
														onClick={() => void openRepo(repo)}
														sx={{ cursor: "pointer" }}
													>
														<TableCell>{repo.name}</TableCell>
														<TableCell>{repo.owner}</TableCell>
														<TableCell sx={{ width: "51%" }}>
															<Button
																variant="text"
																size="small"
																sx={{ marginRight: 1.6 }}
																onClick={(event) => {
																	event.stopPropagation();
																	void openExternal(repo.html_url);
																}}
															>
																{t("nav.github")}
															</Button>
															<Button
																variant="outlined"
																size="small"
																color="error"
																onClick={(event) => {
																	event.stopPropagation();
																	openDelete(repo.owner, repo.name);
																}}
															>
																{t("project.delete")}
															</Button>
														</TableCell>
													</TableRow>
												);
											})}
										</TableBody>
									</Table>
								</TableContainer>
								{filtered.length === 0 ? (
									<Typography color="secondary">
										{t("project.noMatch")}
									</Typography>
								) : null}
							</>
						)}
					</Stack>
				</Paper>
			)}

			{opening ? (
				<Box
					sx={{
						display: "grid",
						gridTemplateColumns: "1fr 1fr",
						gap: 2,
					}}
				>
					<PreviewSkeleton height={220} />
					<PreviewSkeleton height={220} />
				</Box>
			) : bundle ? (
				<Stack spacing={2} className="project-canvas">
					<Stack
						direction="row"
						spacing={1}
						sx={{ alignItems: "center", flexWrap: "wrap" }}
					>
						<Typography variant="h6">
							{bundle.owner}/{bundle.repo}
						</Typography>
						{bundle.branches && bundle.branches.length > 0 ? (
							<Select
								name="branch"
								label={t("project.branch")}
								value={bundle.ref ?? ""}
								onSelect={(next) => {
									void selectBranch(next);
								}}
								sx={{ minWidth: 180 }}
							>
								{bundle.branches.map((branch) => (
									<option key={branch.name} value={branch.name}>
										{branch.name === bundle.defaultBranch
											? t("project.defaultBranch", { name: branch.name })
											: branch.name}
									</option>
								))}
							</Select>
						) : null}
						<Button
							variant="outlined"
							size="small"
							disabled={reloading || opening}
							onClick={() => void reloadBundle()}
						>
							{reloading ? t("project.reloading") : t("project.reload")}
						</Button>
						<Button
							variant="text"
							size="small"
							onClick={() =>
								void openExternal(
									`https://github.com/${bundle.owner}/${bundle.repo}`,
								)
							}
						>
							{t("project.openOnGithub")}
						</Button>
						<Button
							variant="outlined"
							size="small"
							color={runRunning ? "error" : "primary"}
							disabled={stopping || !activeUuid || !runRunning}
							onClick={() => void stopSketch()}
						>
							{stopping ? t("project.stopping") : t("project.stopSketch")}
						</Button>
						<Button
							variant="contained"
							size="small"
							disabled={saving || !activeUuid}
							onClick={() => void saveFromBoard()}
						>
							{saving ? t("project.saving") : t("project.saveToGithub")}
						</Button>
						<Button
							variant="outlined"
							size="small"
							color="error"
							disabled={deleting}
							onClick={() => openDelete(bundle.owner, bundle.repo)}
						>
							{t("project.delete")}
						</Button>
					</Stack>
					{justCreated === bundle.repo ? (
						<Alert severity="success">
							<Stack
								direction="row"
								spacing={2}
								sx={{
									alignItems: "center",
									justifyContent: "space-between",
									flexWrap: "wrap",
								}}
							>
								<Typography>
									{t("project.readyChat", { repo: bundle.repo })}
								</Typography>
								{paired && activeUuid ? (
									<Button variant="contained" onClick={openAgent}>
										{t("project.openCode")}
									</Button>
								) : (
									<Typography color="secondary">
										{t("project.pairSoCodeOpens")}
									</Typography>
								)}
							</Stack>
						</Alert>
					) : null}
					{saveHint ? <Alert severity="success">{saveHint}</Alert> : null}
					<Box
						sx={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(420px, 100%), 1fr))",
							gap: 2,
						}}
					>
						<PreviewCard
							title={t("project.pcb")}
							hint={t("project.noPcbHintDesktop")}
							url={bundle.pcbPreviewUrl}
						/>
						<BreadboardViewer
							diagramText={breadboardJson}
							previewUrl={bundle.breadboardPreviewUrl}
							livePins={livePins}
							arduinoLivePins={arduinoLivePins}
							verifyOverlay={overlay}
							boardModel={activeBoard?.status?.model}
						/>
					</Box>
					<ModelViewer
						activeName={activePart}
						glbBase64={modelGlb}
						onSelect={selectModelPart}
						parts={modelParts}
					/>
					<Box
						sx={{
							display: "grid",
							gridTemplateColumns:
								"repeat(auto-fit, minmax(min(280px, 100%), 1fr))",
							gap: 2,
						}}
					>
						<FileGroup title={t("project.pcb")} files={bundle.pcb} />
						<FileGroup
							title={t("project.breadboard")}
							files={bundle.breadboard}
						/>
						<FileGroup
							title={t("project.technical")}
							files={bundle.technical}
						/>
						<FileGroup title={t("project.model")} files={bundle.model ?? []} />
						<BoardSketchGroup
							title={t("project.hostSketches")}
							action={t("project.run")}
							sketches={hostSketches.filter(
								(item) => item.project === bundle.repo,
							)}
							busy={sketchBusy || !activeUuid}
							onLaunch={(dir) => {
								launchSketch(async () => {
									await startRun({ uuid: activeUuid, dir });
									setRunRunning((await loadRun(activeUuid)).running);
								});
							}}
						/>
					</Box>
				</Stack>
			) : loading || !configured || empty ? null : (
				<Paper className="workbench-control-rail" sx={{ p: 4 }} elevation={0}>
					<Typography color="secondary" align="center">
						{t("project.selectToSee")}
					</Typography>
				</Paper>
			)}
			{paired && activeUuid && bundle ? (
				<Paper
					className="workbench-control-rail"
					sx={{ p: 2, minWidth: 0, overflowX: "hidden" }}
					elevation={0}
				>
					<Stack spacing={2} sx={{ minWidth: 0 }}>
						<Stack spacing={0.5}>
							<Typography variant="subtitle1">
								{t("project.boardTools")}
							</Typography>
							<Typography color="secondary" variant="body2">
								{t("project.boardToolsHint")}
							</Typography>
							<Typography color="secondary" variant="body2">
								{t("project.selectedBoardContext", {
									board:
										activeBoard.device.label ||
										activeBoard.status?.model ||
										activeUuid.slice(0, 8),
								})}
							</Typography>
						</Stack>
						<Alert severity="warning">{t("project.safetyHint")}</Alert>
						<Select
							name="board"
							label={t("docs.board")}
							value={activeUuid}
							onSelect={selectBoard}
						>
							{boards.map((board) => (
								<option key={board.device.uuid} value={board.device.uuid}>
									{board.device.label || board.device.uuid}
								</option>
							))}
						</Select>
						{isEasy ? null : (
							<ToolSection
								title={t("project.advancedBoardTools")}
								hint={t("project.liveGpioHint")}
								open={openTool === "gpio"}
								onToggle={() => toggleTool("gpio")}
							>
								<GpioPanel
									uuid={activeUuid}
									connected={Boolean(activeBoard?.status)}
									poll={openTool === "gpio"}
									onRetry={() => void refetch()}
									onLivePins={(
										pins: Record<number, 0 | 1>,
										target?: GpioTarget,
									) => {
										if (target === "arduino-proxy") {
											setArduinoLivePins(pins);
										} else {
											setLivePins(pins);
										}
									}}
								/>
							</ToolSection>
						)}
						<ToolSection
							title={t("flash.title")}
							hint={t("project.flashHint")}
							open={openTool === "flash"}
							onToggle={() => toggleTool("flash")}
						>
							<FlashPanel uuid={activeUuid} project={bundle.repo} />
						</ToolSection>
						<ToolSection
							title={t("run.title")}
							hint={t("project.runHint")}
							open={openTool === "run"}
							onToggle={() => toggleTool("run")}
						>
							<RunPanel uuid={activeUuid} project={bundle.repo} />
						</ToolSection>
						<ToolSection
							title={t("verify.title")}
							hint={t("verify.hint")}
							open={openTool === "verify"}
							onToggle={() => toggleTool("verify")}
						>
							<VerifyPanel
								uuid={activeUuid}
								project={bundle.repo}
								onResults={setVerifyResults}
							/>
						</ToolSection>
					</Stack>
				</Paper>
			) : null}
			<Dialog
				open={deleteOpen}
				onClose={() => {
					if (!deleting) {
						setDeleteOpen(false);
					}
				}}
				fullWidth
				scroll="paper"
				sx={{ zIndex: 1300 }}
				slotProps={{ paper: { className: "max-w-xl w-full" } }}
			>
				<DialogTitle>{t("project.deleteTitle")}</DialogTitle>
				<DialogContent>
					<Stack spacing={2}>
						<Typography>
							{t("project.deleteConfirmHint", {
								name: pendingDelete?.name ?? "",
							})}
						</Typography>
						<TextField
							label={t("project.colName")}
							value={deleteName}
							onChange={(event) => setDeleteName(event.target.value)}
							autoComplete="off"
							disabled={deleting}
						/>
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button
						type="button"
						variant="text"
						disabled={deleting}
						onClick={() => setDeleteOpen(false)}
					>
						{t("project.cancel")}
					</Button>
					<Button
						type="button"
						variant="contained"
						color="error"
						disabled={
							deleting ||
							!pendingDelete ||
							deleteName.trim() !== pendingDelete.name
						}
						onClick={() => void removeOpenedProject()}
					>
						{deleting ? t("project.deleting") : t("project.deleteConfirm")}
					</Button>
				</DialogActions>
			</Dialog>
		</Stack>
	);
}
