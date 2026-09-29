import { GET as getGithubApp } from "@api/github-app";
import {
	PATCH as createProject,
	DELETE as deleteProject,
	GET as listProjects,
	POST as loadProject,
	PUT as readFile,
} from "@api/projects";
import { POST as saveProject } from "@api/projects/push";
import { GET as loadRun, POST as startRun } from "@api/run";
import { GET as loadRunSketches } from "@api/run/sketches";
import { POST as stopRun } from "@api/run/stop";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import { TablePagination } from "@shpaw415/mui-lite/Pagination";
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
	type BoardSketch,
	type CircuitVerifyItem,
	circuitVerifyOverlay,
	type ModelPart,
	modelPartRepoPath,
	parseModelManifest,
	parseWokwiDiagram,
	type RunStatus,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDeviceHub } from "../hooks/useDeviceHub.ts";
import { useT } from "../hooks/useLocale.tsx";
import useMobile from "../hooks/useMobile.ts";
import { useWorkbench } from "../hooks/useWorkbench.tsx";
import { unwrapAction } from "../lib/action.ts";
import type { GithubRepo, ProjectBundle } from "../lib/github.ts";
import BreadboardViewer from "./BreadboardViewer.tsx";
import ModelViewer from "./ModelViewer.tsx";
import PcbViewer from "./PcbViewer.tsx";
import { PreviewSkeleton, TableRowsSkeleton } from "./skeletons.tsx";

const LAST_REPO_KEY = "gpio-companion-selected-project";

function lastRepoKey(repo: GithubRepo) {
	return `${repo.owner}/${repo.name}`;
}

export default function ProjectBrowser({
	onConfigured,
	onProject,
	uuid,
	paired,
	livePins,
	arduinoLivePins,
	verifyResults,
	boardModel,
}: {
	onConfigured?: (ready: boolean) => void;
	onProject?: (name: string) => void;
	uuid?: string;
	paired?: boolean;
	livePins?: Record<number, 0 | 1>;
	arduinoLivePins?: Record<number, 0 | 1>;
	verifyResults?: CircuitVerifyItem[];
	boardModel?: string | null;
}) {
	const t = useT();
	const [configured, setConfigured] = useState(true);
	const [repos, setRepos] = useState<GithubRepo[]>([]);
	const [loading, setLoading] = useState(true);
	const [loadingRepo, setLoadingRepo] = useState(false);
	const [error, setError] = useState("");
	const [bundle, setBundle] = useState<ProjectBundle | null>(null);
	const [pcbJson, setPcbJson] = useState<string | null>(null);
	const [breadboardJson, setBreadboardJson] = useState<string | null>(null);
	const [modelParts, setModelParts] = useState<ModelPart[]>([]);
	const [activePart, setActivePart] = useState<string | null>(null);
	const [modelGlb, setModelGlb] = useState<string | null>(null);
	const modelToken = useRef(0);
	const [query, setQuery] = useState("");
	const [owner, setOwner] = useState("all");
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10);
	const [createName, setCreateName] = useState("");
	const [creating, setCreating] = useState(false);
	const [canCreate, setCanCreate] = useState(true);
	const [installUrl, setInstallUrl] = useState("");
	const [justCreated, setJustCreated] = useState("");
	const [saving, setSaving] = useState(false);
	const [reloading, setReloading] = useState(false);
	const [saveHint, setSaveHint] = useState("");
	const [stopping, setStopping] = useState(false);
	const [runRunning, setRunRunning] = useState(false);
	const [hostSketches, setHostSketches] = useState<BoardSketch[]>([]);
	const [sketchBusy, setSketchBusy] = useState(false);
	const [deleteOpen, setDeleteOpen] = useState(false);
	const [deleteName, setDeleteName] = useState("");
	const [deleting, setDeleting] = useState(false);
	const [pendingDelete, setPendingDelete] = useState<{
		owner: string;
		name: string;
	} | null>(null);
	const mobile = useMobile();
	const { setWorkSidebar, pendingAction, clearPending } = useWorkbench();
	const openRepoRef = useRef<(repo: GithubRepo) => Promise<void>>(
		async () => undefined,
	);
	const saveRef = useRef<() => Promise<void>>(async () => undefined);
	const overlay = useMemo(() => {
		if (!breadboardJson || !verifyResults?.length) {
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
		listProjects()
			.then((result) => {
				const data = unwrapAction(result);
				setConfigured(data.configured);
				setRepos(data.repos);
				onConfigured?.(data.configured);
			})
			.catch((err: unknown) => {
				setError(
					translateError(
						t,
						err instanceof Error ? err.message : "failed to list project",
					),
				);
			})
			.finally(() => {
				setLoading(false);
			});
	}, [onConfigured, t]);

	useEffect(() => {
		void getGithubApp()
			.then((result) => {
				const data = unwrapAction(result);
				setCanCreate(data.canCreate);
				setInstallUrl(data.installUrl);
			})
			.catch(() => undefined);
	}, []);

	useEffect(() => {
		if (!uuid) {
			setHostSketches([]);
			setRunRunning(false);
			return;
		}
		let cancelled = false;
		loadRunSketches(uuid)
			.then((host) => {
				if (cancelled) {
					return;
				}
				setHostSketches(unwrapAction(host).sketches);
			})
			.catch(() => {
				if (cancelled) {
					return;
				}
				setHostSketches([]);
			});
		loadRun(uuid)
			.then((result) => {
				if (!cancelled) {
					setRunRunning(unwrapAction(result).running);
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
	}, [uuid]);

	const onRun = useCallback((next: RunStatus) => {
		setRunRunning(next.running);
	}, []);
	useDeviceHub(uuid ?? "", { onRun });

	const owners = useMemo(() => {
		return [...new Set(repos.map((repo) => repo.owner))].sort();
	}, [repos]);

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

	const paged = filtered.slice(
		page * rowsPerPage,
		page * rowsPerPage + rowsPerPage,
	);

	async function makeProject() {
		const name = createName.trim();
		if (!name || creating) {
			return;
		}
		setError("");
		setCreating(true);
		try {
			const repo = unwrapAction(await createProject(name));
			setRepos((current) =>
				current.some((item) => item.full_name === repo.full_name)
					? current
					: [repo, ...current],
			);
			setCreateName("");
			setJustCreated(repo.name);
			await openRepo(repo, true);
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to create project",
				),
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
			unwrapAction(
				await deleteProject(pendingDelete.owner, pendingDelete.name),
			);
			setRepos((current) =>
				current.filter(
					(item) =>
						!(
							item.owner === pendingDelete.owner &&
							item.name === pendingDelete.name
						),
				),
			);
			if (
				bundle?.owner === pendingDelete.owner &&
				bundle.repo === pendingDelete.name
			) {
				setBundle(null);
				setPcbJson(null);
				setBreadboardJson(null);
				setModelParts([]);
				setActivePart(null);
				setModelGlb(null);
				onProject?.("");
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
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to delete project",
				),
			);
		} finally {
			setDeleting(false);
		}
	}

	async function applyBundle(next: ProjectBundle) {
		setBundle(next);
		onProject?.(next.repo);
		setPcbJson(null);
		setBreadboardJson(null);
		void loadModel(next);
		if (next.pcbCircuitJsonUrl) {
			const file = unwrapAction(
				await readFile(next.owner, next.repo, "pcb/circuit.json", next.ref),
			);
			setPcbJson(file.text);
		}
		const breadboardPath = next.breadboardDiagramUrl
			? "breadboard/diagram.json"
			: next.breadboardCircuitJsonUrl
				? "breadboard/circuit.json"
				: null;
		if (breadboardPath) {
			const file = unwrapAction(
				await readFile(next.owner, next.repo, breadboardPath, next.ref),
			);
			setBreadboardJson(file.text);
		}
	}

	async function loadModel(next: ProjectBundle, partName?: string) {
		const token = ++modelToken.current;
		if (partName) {
			setActivePart(partName);
			setModelGlb(null);
		} else {
			setModelParts([]);
			setActivePart(null);
			setModelGlb(null);
		}
		const listed = next.model ?? [];
		const hasManifest =
			Boolean(next.modelManifestUrl) ||
			listed.some(
				(file) =>
					file.name === "manifest.json" || file.path === "model/manifest.json",
			);
		if (next.model && !hasManifest) {
			setModelParts([]);
			setActivePart(null);
			setModelGlb(null);
			return;
		}
		try {
			const file = unwrapAction(
				await readFile(next.owner, next.repo, "model/manifest.json", next.ref),
			);
			if (modelToken.current !== token) {
				return;
			}
			const manifest = parseModelManifest(file.text);
			setModelParts(manifest.parts);
			const part =
				manifest.parts.find((item) => item.name === partName) ??
				manifest.parts[0];
			if (!part) {
				setActivePart(null);
				setModelGlb(null);
				return;
			}
			setActivePart(part.name);
			setModelGlb(null);
			const glb = unwrapAction(
				await readFile(
					next.owner,
					next.repo,
					modelPartRepoPath(part.file),
					next.ref,
				),
			);
			if (modelToken.current !== token) {
				return;
			}
			setModelGlb(glb.base64 || null);
		} catch {
			if (modelToken.current !== token) {
				return;
			}
			setModelParts([]);
			setActivePart(null);
			setModelGlb(null);
		}
	}

	function selectModelPart(name: string) {
		if (!bundle) {
			return;
		}
		void loadModel(bundle, name);
	}

	async function openRepo(repo: GithubRepo, created = false) {
		if (!created) {
			setJustCreated("");
		}
		setError("");
		setSaveHint("");
		setPcbJson(null);
		setBreadboardJson(null);
		setLoadingRepo(true);
		try {
			window.localStorage.setItem(LAST_REPO_KEY, lastRepoKey(repo));
		} catch {
			// ignore
		}
		try {
			await applyBundle(unwrapAction(await loadProject(repo.owner, repo.name)));
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to load project",
				),
			);
		} finally {
			setLoadingRepo(false);
		}
	}
	openRepoRef.current = openRepo;

	useEffect(() => {
		if (pendingAction !== "save" || !bundle || !uuid || saving) {
			return;
		}
		clearPending();
		void saveRef.current();
	}, [bundle, clearPending, pendingAction, saving, uuid]);

	useEffect(() => {
		const repoEntries = filtered.slice(0, 8).map((repo) => ({
			id: `repo:${repo.owner}/${repo.name}`,
			label: repo.name,
			hint: repo.owner,
			active: bundle?.repo === repo.name && bundle.owner === repo.owner,
			onSelect: () => {
				void openRepoRef.current(repo);
			},
		}));
		const files = bundle
			? [
					...bundle.pcb,
					...bundle.breadboard,
					...bundle.technical,
					...(bundle.model ?? []),
				].slice(0, 16)
			: [];
		const fileEntries = files.map((file) => ({
			id: `file:${file.path}`,
			label: file.name || file.path,
			hint: "file",
			href: file.download_url ?? undefined,
		}));
		setWorkSidebar([...repoEntries, ...fileEntries]);
		return () => setWorkSidebar([]);
	}, [bundle, filtered, setWorkSidebar]);

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
	}, [loading, repos]);

	async function selectBranch(ref: string) {
		if (!bundle || !ref || ref === bundle.ref || loadingRepo || reloading) {
			return;
		}
		setError("");
		setSaveHint("");
		setPcbJson(null);
		setBreadboardJson(null);
		setLoadingRepo(true);
		try {
			await applyBundle(
				unwrapAction(await loadProject(bundle.owner, bundle.repo, ref)),
			);
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to load branch",
				),
			);
		} finally {
			setLoadingRepo(false);
		}
	}

	// biome-ignore lint/correctness/useExhaustiveDependencies: applyBundle is render-local and only uses setters
	const reloadBundle = useCallback(async () => {
		const current = bundle;
		if (!current || loadingRepo || reloading || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setReloading(true);
		try {
			await applyBundle(
				unwrapAction(await loadProject(current.owner, current.repo)),
			);
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to load project",
				),
			);
		} finally {
			setReloading(false);
		}
	}, [bundle, loadingRepo, reloading, saving, t]);

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

	async function stopSketch() {
		if (!uuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			unwrapAction(await stopRun(uuid));
			setRunRunning(unwrapAction(await loadRun(uuid)).running);
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to stop sketch",
				),
			);
		} finally {
			setStopping(false);
		}
	}

	async function saveFromBoard() {
		if (!bundle || !uuid || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setSaving(true);
		try {
			const result = unwrapAction(
				await saveProject({
					uuid,
					owner: bundle.owner,
					name: bundle.repo,
				}),
			);
			await applyBundle(result.bundle);
			setSaveHint(
				result.board.committed
					? t("project.savedPushed")
					: t("project.alreadyUpToDate"),
			);
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to save project",
				),
			);
		} finally {
			setSaving(false);
		}
	}
	saveRef.current = saveFromBoard;

	function launch(task: () => Promise<void>) {
		setSketchBusy(true);
		setError("");
		void task()
			.catch((caught) => {
				setError(
					translateError(
						t,
						caught instanceof Error ? caught.message : "request failed",
					),
				);
			})
			.finally(() => setSketchBusy(false));
	}

	const empty = !loading && repos.length === 0;

	function createFields(hero: boolean) {
		if (!canCreate) {
			return (
				<Stack spacing={2}>
					{hero ? (
						<Typography variant="h6">{t("project.createFirst")}</Typography>
					) : null}
					<Alert severity="info">{t("project.authorizeHint")}</Alert>
					<Button
						href={installUrl || "/profile/github"}
						variant="contained"
						className={mobile ? "w-full" : undefined}
					>
						{t("project.authorizeRepos")}
					</Button>
				</Stack>
			);
		}
		return (
			<Stack spacing={2}>
				{hero ? (
					<>
						<Typography variant="h6">{t("project.createFirst")}</Typography>
						<Typography color="secondary">{t("project.createHint")}</Typography>
					</>
				) : null}
				<Stack
					direction={mobile ? "column" : "row"}
					spacing={2}
					sx={{
						flexWrap: "wrap",
						alignItems: mobile ? "stretch" : "flex-end",
					}}
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
						className="min-w-0 w-full flex-1"
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
		);
	}

	if (!configured) {
		return (
			<Alert severity="info">
				<Button href="/profile/github" variant="text">
					{t("project.connectGithubAlert")}
				</Button>
			</Alert>
		);
	}

	return (
		<Stack spacing={1.5} className="project-browser">
			<Paper className="workbench-control-rail p-3" elevation={0}>
				<Stack spacing={2}>
					{createFields(empty)}
					{empty ? null : (
						<>
							<Stack
								direction={mobile ? "column" : "row"}
								spacing={2}
								sx={{
									flexWrap: "wrap",
									alignItems: mobile ? "stretch" : "flex-end",
								}}
							>
								<TextField
									label={t("project.filter")}
									placeholder={t("project.filterPlaceholder")}
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										setPage(0);
									}}
									className="min-w-0 w-full flex-1"
								/>
								<Select
									name="owner"
									label={t("project.owner")}
									value={owner}
									onSelect={(next) => {
										setOwner(next);
										setPage(0);
									}}
									className="min-w-0 w-full min-[900px]:w-auto min-[900px]:min-w-[12rem]"
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
											{mobile ? null : (
												<TableCell>{t("project.colRepo")}</TableCell>
											)}
											<TableCell />
										</TableRow>
									</TableHead>
									<TableBody>
										{loading ? (
											<TableRowsSkeleton rows={5} columns={mobile ? 3 : 4} />
										) : (
											paged.map((repo) => (
												<TableRow
													key={repo.full_name}
													hover
													selected={
														bundle?.owner === repo.owner &&
														bundle?.repo === repo.name
													}
													onClick={() => void openRepo(repo)}
												>
													<TableCell className="break-all">
														{repo.name}
													</TableCell>
													<TableCell className="break-all">
														{repo.owner}
													</TableCell>
													{mobile ? null : (
														<TableCell className="break-all">
															{repo.full_name}
														</TableCell>
													)}
													<TableCell>
														<Button
															type="button"
															variant="text"
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
											))
										)}
									</TableBody>
								</Table>
							</TableContainer>
							{loading ? null : filtered.length === 0 ? (
								<Typography color="secondary">
									{t("project.noMatch")}
								</Typography>
							) : (
								<TablePagination
									count={filtered.length}
									page={page}
									rowsPerPage={rowsPerPage}
									onPageChange={(_event, nextPage) => setPage(nextPage)}
									onRowsPerPageChange={(next) => {
										setRowsPerPage(next);
										setPage(0);
									}}
								/>
							)}
						</>
					)}
				</Stack>
			</Paper>
			<Stack spacing={1.5}>
				{error ? <Alert severity="error">{error}</Alert> : null}
				{loadingRepo ? (
					<>
						<PreviewSkeleton />
						<PreviewSkeleton />
					</>
				) : bundle ? (
					<section className="project-canvas">
						<Stack
							direction={mobile ? "column" : "row"}
							spacing={2}
							sx={{
								flexWrap: "wrap",
								alignItems: mobile ? "stretch" : "center",
								justifyContent: "space-between",
							}}
							className="project-canvas-toolbar"
						>
							<Typography variant="h6" className="break-all">
								{bundle.owner}/{bundle.repo}
							</Typography>
							<Stack
								direction={mobile ? "column" : "row"}
								spacing={1}
								sx={{
									alignItems: mobile ? "stretch" : "center",
									minWidth: 0,
									width: mobile ? "100%" : "auto",
								}}
							>
								{bundle.branches.length > 0 ? (
									<Select
										name="branch"
										label={t("project.branch")}
										value={bundle.ref}
										onSelect={(next) => {
											void selectBranch(next);
										}}
										className="min-w-0 w-full min-[900px]:w-auto min-[900px]:min-w-[12rem]"
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
									disabled={reloading || loadingRepo}
									onClick={() => void reloadBundle()}
									className={mobile ? "w-full" : undefined}
								>
									{reloading ? t("project.reloading") : t("project.reload")}
								</Button>
							</Stack>
							<Stack
								direction="row"
								spacing={1}
								sx={{
									flexWrap: "wrap",
									alignItems: "center",
								}}
							>
								<Button
									variant="outlined"
									color={runRunning ? "error" : "primary"}
									disabled={stopping || !uuid || !runRunning}
									onClick={() => void stopSketch()}
									className={mobile ? "flex-1" : undefined}
								>
									{stopping ? t("project.stopping") : t("project.stopSketch")}
								</Button>
								<Button
									variant="contained"
									disabled={saving || !uuid}
									onClick={() => void saveFromBoard()}
									className={mobile ? "flex-1" : undefined}
								>
									{saving ? t("project.saving") : t("project.saveToGithub")}
								</Button>
								<Button
									variant="outlined"
									color="error"
									disabled={deleting}
									onClick={() => openDelete(bundle.owner, bundle.repo)}
									className={mobile ? "flex-1" : undefined}
								>
									{t("project.delete")}
								</Button>
							</Stack>
						</Stack>
						{justCreated === bundle.repo ? (
							<Alert severity="success">
								<Stack
									direction={mobile ? "column" : "row"}
									spacing={2}
									sx={{
										alignItems: mobile ? "stretch" : "center",
										justifyContent: "space-between",
									}}
								>
									<Typography>
										{t("project.readyChat", { repo: bundle.repo })}
									</Typography>
									{paired ? (
										<Button
											href="/devices/code"
											variant="contained"
											className={mobile ? "w-full" : undefined}
										>
											{t("project.openCode")}
										</Button>
									) : (
										<Button
											href="/devices"
											variant="contained"
											className={mobile ? "w-full" : undefined}
										>
											{t("project.pairABoard")}
										</Button>
									)}
								</Stack>
							</Alert>
						) : null}
						{uuid ? null : (
							<Typography color="secondary">
								{t("project.selectBoardToSave")}
							</Typography>
						)}
						{saveHint ? <Alert severity="success">{saveHint}</Alert> : null}
						<div className="project-preview-grid">
							<PcbViewer
								circuitJsonText={pcbJson}
								label={t("project.pcb")}
								previewUrl={bundle.pcbPreviewUrl}
							/>
							<BreadboardViewer
								diagramText={breadboardJson}
								previewUrl={bundle.breadboardPreviewUrl}
								livePins={livePins}
								arduinoLivePins={arduinoLivePins}
								verifyOverlay={overlay}
								boardModel={boardModel}
							/>
						</div>
						<ModelViewer
							activeName={activePart}
							glbBase64={modelGlb}
							onSelect={selectModelPart}
							parts={modelParts}
						/>
						<div className="project-assets-grid">
							<FileGroup title={t("project.pcb")} files={bundle.pcb} />
							<FileGroup
								title={t("project.breadboard")}
								files={bundle.breadboard}
							/>
							<FileGroup
								title={t("project.technical")}
								files={bundle.technical}
							/>
							<FileGroup
								title={t("project.model")}
								files={bundle.model ?? []}
							/>
							<BoardSketchGroup
								title={t("project.hostSketches")}
								action={t("project.run")}
								sketches={hostSketches.filter(
									(item) => item.project === bundle.repo,
								)}
								busy={sketchBusy || !uuid}
								onLaunch={(dir) => {
									if (!uuid) {
										return;
									}
									launch(async () => {
										unwrapAction(await startRun({ uuid, dir }));
										setRunRunning(unwrapAction(await loadRun(uuid)).running);
									});
								}}
							/>
						</div>
					</section>
				) : empty ? null : (
					<Paper className="workbench-empty" elevation={0}>
						<Typography color="secondary">
							{t("project.selectProject")}
						</Typography>
					</Paper>
				)}
			</Stack>
			<Dialog
				open={deleteOpen}
				onClose={() => {
					if (!deleting) {
						setDeleteOpen(false);
					}
				}}
				fullWidth
				fullScreen={mobile}
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
		<Paper className="p-4" elevation={1}>
			<Typography variant="h6" className="mb-2">
				{title}
			</Typography>
			{sketches.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("project.noneOnBoard")}
				</Typography>
			) : (
				<Stack spacing={1}>
					{sketches.map((item) => (
						<Stack
							key={item.dir}
							direction="row"
							spacing={1}
							className="items-center justify-between"
						>
							<Typography variant="body2">{item.name}</Typography>
							<Button
								type="button"
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
	files: { name: string; path: string; download_url: string | null }[];
}) {
	const t = useT();
	return (
		<Paper className="p-4" elevation={1}>
			<Typography variant="h6" className="mb-2">
				{title}
			</Typography>
			{files.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("project.noFiles")}
				</Typography>
			) : (
				<Stack spacing={1}>
					{files.map((file) =>
						file.download_url ? (
							<Button
								key={file.path}
								href={file.download_url}
								variant="text"
								size="small"
								className="max-w-full justify-start break-all"
							>
								{file.path}
							</Button>
						) : (
							<Typography key={file.path} variant="body2">
								{file.path}
							</Typography>
						),
					)}
				</Stack>
			)}
		</Paper>
	);
}
