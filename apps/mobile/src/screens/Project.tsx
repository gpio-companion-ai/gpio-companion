import { useFocusEffect, useRouter } from "expo-router";
import {
	type ModelPart,
	modelPartRepoPath,
	parseModelManifest,
} from "gpio-companion-model";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { Linking, Modal, Pressable, Text, View } from "react-native";
import BreadboardWebView from "../components/BreadboardWebView.tsx";
import FlashPanel from "../components/FlashPanel.tsx";
import GpioPanel from "../components/GpioPanel.tsx";
import JlcpcbCard from "../components/JlcpcbCard.tsx";
import ModelWebView from "../components/ModelWebView.tsx";
import RunPanel from "../components/RunPanel.tsx";
import {
	Body,
	Chip,
	ErrorText,
	Field,
	Muted,
	Paper,
	PrimaryButton,
	Screen,
	Skeleton,
	TextButton,
	Title,
} from "../components/ui.tsx";
import VerifyPanel from "../components/VerifyPanel.tsx";
import ZoomableImage from "../components/ZoomableImage.tsx";
import {
	type BoardSketch,
	type CircuitVerifyState,
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
	type ProjectBundle,
	pushProject,
	type RunStatus,
	readProjectFile,
	startRun,
	stopRun,
} from "../lib/api.ts";
import {
	CACHE_KEYS,
	useApiCache,
	useCachedQuery,
	useUserBoards,
} from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useDashboardMode } from "../lib/dashboard-mode.tsx";
import { useDeckNav } from "../lib/deck-nav.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import { storageGet, storageRemove, storageSet } from "../lib/storage.ts";
import { useDeviceHub as useRunHub } from "../lib/use-device-hub.ts";

const LAST_REPO_KEY = "gpio-companion-selected-project";

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
	const colors = useColors();
	return (
		<Paper>
			{url ? <ZoomableImage title={title} uri={url} /> : <Muted>{hint}</Muted>}
			<Text style={{ color: colors.muted }}>{title}</Text>
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
		<Paper>
			<Body>{title}</Body>
			{sketches.length === 0 ? (
				<Muted>{t("project.noneOnBoard")}</Muted>
			) : (
				sketches.map((item) => (
					<View
						key={item.dir}
						style={{
							flexDirection: "row",
							alignItems: "center",
							justifyContent: "space-between",
						}}
					>
						<Body>{item.name}</Body>
						<TextButton
							label={action}
							disabled={busy}
							onPress={() => onLaunch(item.dir)}
						/>
					</View>
				))
			)}
		</Paper>
	);
}

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
	const colors = useColors();
	const [seen, setSeen] = useState(false);
	useEffect(() => {
		if (open) {
			setSeen(true);
		}
	}, [open]);
	return (
		<View
			style={{
				borderWidth: 1,
				borderLeftWidth: 3,
				borderColor: open ? colors.primary : colors.border,
				borderRadius: 10,
				overflow: "hidden",
				backgroundColor: colors.bg,
			}}
		>
			<Pressable
				accessibilityRole="button"
				accessibilityState={{ expanded: open }}
				accessibilityLabel={title}
				onPress={onToggle}
				style={{
					minHeight: 48,
					paddingHorizontal: 12,
					paddingVertical: 8,
					flexDirection: "row",
					alignItems: "center",
					gap: 8,
				}}
			>
				<View style={{ flex: 1, gap: 2 }}>
					<Text style={{ color: colors.text, fontWeight: "600" }}>{title}</Text>
					{open ? null : (
						<Text
							numberOfLines={2}
							style={{ color: colors.muted, fontSize: 12 }}
						>
							{hint}
						</Text>
					)}
				</View>
				<Text style={{ color: open ? colors.primary : colors.muted }}>
					{open ? "▾" : "▸"}
				</Text>
			</Pressable>
			{seen ? (
				<View
					style={
						open
							? {
									borderTopWidth: 1,
									borderTopColor: colors.border,
									padding: 10,
									gap: 8,
								}
							: { display: "none" }
					}
				>
					{children}
				</View>
			) : null}
		</View>
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
		<Paper>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<Body>{title}</Body>
				<Chip label={`${files.length}`} />
			</View>
			{files.length === 0 ? (
				<Muted>{t("project.emptyFolder")}</Muted>
			) : (
				files.map((file) =>
					file.download_url ? (
						<TextButton
							key={file.path}
							label={file.path}
							onPress={() => void Linking.openURL(file.download_url ?? "")}
						/>
					) : (
						<Muted key={file.path}>{file.path}</Muted>
					),
				)
			)}
		</Paper>
	);
}

export default function Project() {
	const auth = useAuth();
	const t = useT();
	const colors = useColors();
	const token = auth.token;
	const { cache } = useApiCache();
	const githubQuery = useCachedQuery(CACHE_KEYS.githubApp, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return getGithubApp(token);
	});
	const projectsQuery = useCachedQuery(CACHE_KEYS.projects, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return listProjects(token);
	});
	const { boards, paired } = useUserBoards();
	const { uuid: selectedUuid, setUuid: selectBoard } = useBoardSelection();
	const { flashSketch } = useBoardSelection();
	const { setTab } = useDeviceHub();
	const router = useRouter();
	const { setWorkItems } = useDeckNav();
	const app = githubQuery.data ?? null;
	const repos = projectsQuery.data?.repos ?? [];
	const configured = projectsQuery.data?.configured ?? false;
	const loading = githubQuery.loading || projectsQuery.loading;
	const [bundle, setBundle] = useState<ProjectBundle | null>(null);
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
	const [breadboardJson, setBreadboardJson] = useState<string | null>(null);
	const [modelParts, setModelParts] = useState<ModelPart[]>([]);
	const [activePart, setActivePart] = useState<string | null>(null);
	const [modelGlb, setModelGlb] = useState<string | null>(null);
	const modelToken = useRef(0);
	const [livePins, setLivePins] = useState<Record<number, 0 | 1>>({});
	const [arduinoLivePins, setArduinoLivePins] = useState<Record<number, 0 | 1>>(
		{},
	);
	const [verifyResults, setVerifyResults] = useState<
		CircuitVerifyState["results"]
	>([]);
	const activeBoard =
		boards.find((board) => board.device.uuid === selectedUuid) ?? boards[0];
	const activeUuid = activeBoard?.device.uuid ?? "";

	useEffect(() => {
		if (!activeUuid || !token) {
			setHostSketches([]);
			setRunRunning(false);
			return;
		}
		let cancelled = false;
		loadRunSketches(token, activeUuid)
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
		loadRun(token, activeUuid)
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
	}, [activeUuid, token]);

	useEffect(() => {
		if (!bundle || !token) {
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
		void readProjectFile(token, bundle.owner, bundle.repo, path, bundle.ref)
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
	}, [bundle, token]);

	useEffect(() => {
		if (!bundle || !token) {
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
		const generation = ++modelToken.current;
		let cancelled = false;
		setModelParts([]);
		setActivePart(null);
		setModelGlb(null);
		void readProjectFile(
			token,
			bundle.owner,
			bundle.repo,
			"model/manifest.json",
			bundle.ref,
		)
			.then(async (file) => {
				if (cancelled || modelToken.current !== generation) {
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
					token,
					bundle.owner,
					bundle.repo,
					modelPartRepoPath(part.file),
					bundle.ref,
				);
				if (!cancelled && modelToken.current === generation) {
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
	}, [bundle, token]);

	function selectModelPart(name: string) {
		if (!bundle || !token) {
			return;
		}
		const part = modelParts.find((item) => item.name === name);
		if (!part) {
			return;
		}
		const generation = ++modelToken.current;
		setActivePart(name);
		setModelGlb(null);
		void readProjectFile(
			token,
			bundle.owner,
			bundle.repo,
			modelPartRepoPath(part.file),
			bundle.ref,
		)
			.then((file) => {
				if (modelToken.current === generation) {
					setModelGlb(file.base64 || null);
				}
			})
			.catch(() => {
				if (modelToken.current === generation) {
					setModelGlb(null);
				}
			});
	}

	const onRun = useCallback((next: RunStatus) => {
		setRunRunning(next.running);
	}, []);
	useRunHub(activeUuid, token, { onRun });

	function launchSketch(task: () => Promise<void>) {
		setSketchBusy(true);
		setError("");
		void task()
			.catch((caught) => {
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => setSketchBusy(false));
	}

	const reloadBundle = useCallback(async () => {
		if (!token || !bundle || opening || reloading || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setReloading(true);
		try {
			const next = await cache.get(
				CACHE_KEYS.projectBundle(bundle.owner, bundle.repo),
				() => loadProject(token, bundle.owner, bundle.repo),
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
	}, [bundle, cache, opening, reloading, saving, token]);

	const reloadRef = useRef(reloadBundle);
	reloadRef.current = reloadBundle;

	useFocusEffect(
		useCallback(() => {
			if (!token) {
				return;
			}
			void listProjects(token)
				.then((projects) => {
					projectsQuery.setData(projects);
				})
				.catch(() => undefined);
			void reloadRef.current();
		}, [token, projectsQuery.setData]),
	);

	useEffect(() => {
		if ((app?.connected && app.canCreate) || loading) {
			return;
		}
		const timer = setInterval(() => {
			if (!token) {
				return;
			}
			void Promise.all([getGithubApp(token), listProjects(token)])
				.then(([github, projects]) => {
					githubQuery.setData(github);
					projectsQuery.setData(projects);
				})
				.catch(() => undefined);
		}, 2500);
		return () => clearInterval(timer);
	}, [
		app?.canCreate,
		app?.connected,
		loading,
		token,
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
		if (!name || creating || !token) {
			return;
		}
		setError("");
		setCreating(true);
		try {
			const repo = await createProject(token, name);
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
		if (!token || !pendingDelete || deleting) {
			return;
		}
		if (deleteName.trim() !== pendingDelete.name) {
			return;
		}
		setError("");
		setDeleting(true);
		try {
			await deleteProject(token, pendingDelete.owner, pendingDelete.name);
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
				void storageRemove(LAST_REPO_KEY);
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
		if (!token || !activeUuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			await stopRun(token, activeUuid);
			setRunRunning((await loadRun(token, activeUuid)).running);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to stop sketch",
			);
		} finally {
			setStopping(false);
		}
	}

	async function saveFromBoard() {
		if (!bundle || !token || !activeUuid || saving) {
			return;
		}
		setError("");
		setSaveHint("");
		setSaving(true);
		try {
			const result = await pushProject(token, {
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
		if (
			!token ||
			!bundle ||
			!ref ||
			ref === bundle.ref ||
			opening ||
			reloading
		) {
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
				loadProject(token, bundle.owner, bundle.repo, ref),
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

	const openRepoRef = useRef<(repo: GithubRepo, created?: boolean) => void>(
		() => undefined,
	);

	async function openRepo(repo: GithubRepo, created = false) {
		if (!token) {
			return;
		}
		if (!created) {
			setJustCreated("");
		}
		setError("");
		setSaveHint("");
		const key = CACHE_KEYS.projectBundle(repo.owner, repo.name);
		const hit = cache.peek<ProjectBundle>(key);
		if (hit.hit && bundleReady(hit.value)) {
			setBundle(hit.value);
			void storageSet(LAST_REPO_KEY, lastRepoKey(repo));
			void cache
				.get(key, () => loadProject(token, repo.owner, repo.name), true)
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
				() => loadProject(token, repo.owner, repo.name),
				hit.hit,
			);
			rememberProjectBundle(cache, next);
			setBundle(next);
			void storageSet(LAST_REPO_KEY, lastRepoKey(repo));
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to load project",
			);
		} finally {
			setOpening(false);
		}
	}
	openRepoRef.current = openRepo;

	useEffect(() => {
		const repoEntries = filtered.slice(0, 8).map((repo) => ({
			id: `repo:${repo.owner}/${repo.name}`,
			label: repo.name,
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
			onSelect: file.download_url
				? () => {
						void Linking.openURL(file.download_url ?? "");
					}
				: undefined,
		}));
		setWorkItems([...repoEntries, ...fileEntries]);
		return () => setWorkItems([]);
	}, [bundle, filtered, setWorkItems]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: open last/first repo once the list is ready
	useEffect(() => {
		if (loading || bundle || repos.length === 0) {
			return;
		}
		void storageGet(LAST_REPO_KEY).then((stored) => {
			const match =
				repos.find((repo) => lastRepoKey(repo) === stored) ?? repos[0];
			if (match) {
				void openRepo(match);
			}
		});
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

	// biome-ignore lint/correctness/useExhaustiveDependencies: open the flash tool when a sketch was preselected from the Code page
	useEffect(() => {
		if (
			bundle &&
			flashSketch &&
			flashSketch.project === bundle.repo &&
			openTool !== "flash"
		) {
			toggleTool("flash");
		}
	}, [bundle, flashSketch]);

	return (
		<Screen>
			{paired && activeUuid ? (
				<TextButton
					label={t("project.openCode")}
					onPress={() => {
						setTab("code");
						router.navigate("/");
					}}
				/>
			) : null}
			{token ? <JlcpcbCard token={token} /> : null}
			<ErrorText>
				{translateError(
					t,
					error || githubQuery.error || projectsQuery.error || "",
				)}
			</ErrorText>
			{loading ? (
				<>
					<Skeleton />
					<Skeleton />
				</>
			) : null}
			{loading || app?.connected ? null : (
				<Paper>
					<Body>{t("project.connectGithubNative")}</Body>
					<Muted>{t("project.connectGithubNativeHint")}</Muted>
					<PrimaryButton
						label={t("github.connect")}
						disabled={!app?.installUrl}
						onPress={() => void Linking.openURL(app?.installUrl ?? "")}
					/>
					{paired ? null : <Muted>{t("project.pairWhenReady")}</Muted>}
				</Paper>
			)}
			{loading || !configured ? null : (
				<Paper>
					{canCreate ? (
						<>
							{empty ? (
								<>
									<Body>{t("project.createFirst")}</Body>
									<Muted>{t("project.createHint")}</Muted>
								</>
							) : null}
							<Field
								label={t("project.newProject")}
								value={createName}
								onChangeText={setCreateName}
								placeholder={t("project.placeholderName")}
							/>
							<PrimaryButton
								label={creating ? t("project.creating") : t("project.create")}
								disabled={creating || !createName.trim()}
								onPress={() => void makeProject()}
							/>
						</>
					) : (
						<>
							{empty ? <Body>{t("project.createFirst")}</Body> : null}
							<Muted>{t("project.authorizeHint")}</Muted>
							<PrimaryButton
								label={t("project.authorizeRepos")}
								disabled={!app?.installUrl}
								onPress={() => void Linking.openURL(app?.installUrl ?? "")}
							/>
						</>
					)}
					{empty ? null : (
						<>
							<Field
								label={t("project.filter")}
								value={query}
								onChangeText={setQuery}
								placeholder={t("project.filterPlaceholder")}
							/>
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
								<Pressable
									onPress={() => setOwner("all")}
									style={{
										borderWidth: 1,
										borderColor:
											owner === "all" ? colors.primary : colors.border,
										borderRadius: 999,
										paddingHorizontal: 10,
										paddingVertical: 6,
									}}
								>
									<Text
										style={{
											color: owner === "all" ? colors.primary : colors.text,
										}}
									>
										{t("project.allOwners")}
									</Text>
								</Pressable>
								{owners.map((login) => (
									<Pressable
										key={login}
										onPress={() => setOwner(login)}
										style={{
											borderWidth: 1,
											borderColor:
												owner === login ? colors.primary : colors.border,
											borderRadius: 999,
											paddingHorizontal: 10,
											paddingVertical: 6,
										}}
									>
										<Text
											style={{
												color: owner === login ? colors.primary : colors.text,
											}}
										>
											{login}
										</Text>
									</Pressable>
								))}
							</View>
							{filtered.map((repo) => {
								const key = lastRepoKey(repo);
								const selected = selectedKey === key;
								return (
									<Pressable
										key={key}
										onPress={() => void openRepo(repo)}
										style={{
											paddingVertical: 10,
											borderBottomWidth: 1,
											borderBottomColor: colors.border,
										}}
									>
										<Text
											style={{
												color: selected ? colors.primary : colors.text,
												fontWeight: selected ? "700" : "500",
											}}
										>
											{repo.name}
										</Text>
										<Muted>{repo.owner}</Muted>
										<TextButton
											label={t("nav.github")}
											onPress={() => void Linking.openURL(repo.html_url)}
										/>
										<TextButton
											label={t("project.delete")}
											danger
											onPress={() => openDelete(repo.owner, repo.name)}
										/>
									</Pressable>
								);
							})}
							{filtered.length === 0 ? (
								<Muted>{t("project.noMatch")}</Muted>
							) : null}
						</>
					)}
				</Paper>
			)}
			{opening ? (
				<>
					<Skeleton height={180} />
					<Skeleton height={180} />
				</>
			) : bundle ? (
				<Paper>
					<Body>
						{bundle.owner}/{bundle.repo}
					</Body>
					{bundle.branches && bundle.branches.length > 0 ? (
						<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
							{bundle.branches.map((branch) => {
								const selected = branch.name === bundle.ref;
								const label =
									branch.name === bundle.defaultBranch
										? t("project.defaultBranch", { name: branch.name })
										: branch.name;
								return (
									<Pressable
										key={branch.name}
										onPress={() => void selectBranch(branch.name)}
										style={{
											borderWidth: 1,
											borderColor: selected ? colors.primary : colors.border,
											borderRadius: 999,
											paddingHorizontal: 10,
											paddingVertical: 6,
										}}
									>
										<Text
											style={{
												color: selected ? colors.primary : colors.text,
											}}
										>
											{label}
										</Text>
									</Pressable>
								);
							})}
						</View>
					) : null}
					<TextButton
						label={reloading ? t("project.reloading") : t("project.reload")}
						disabled={reloading || opening}
						onPress={() => void reloadBundle()}
					/>
					<TextButton
						label={t("project.openOnGithub")}
						onPress={() =>
							void Linking.openURL(
								`https://github.com/${bundle.owner}/${bundle.repo}`,
							)
						}
					/>
					<TextButton
						label={stopping ? t("project.stopping") : t("project.stopSketch")}
						danger={runRunning}
						disabled={stopping || !activeUuid || !runRunning}
						onPress={() => void stopSketch()}
					/>
					<PrimaryButton
						label={saving ? t("project.saving") : t("project.saveToGithub")}
						disabled={saving || !activeUuid}
						onPress={() => void saveFromBoard()}
					/>
					<TextButton
						label={t("project.delete")}
						danger
						disabled={deleting}
						onPress={() => openDelete(bundle.owner, bundle.repo)}
					/>
					{justCreated === bundle.repo ? (
						<Paper>
							<Body>{t("project.readyChat", { repo: bundle.repo })}</Body>
							{paired && activeUuid ? (
								<PrimaryButton
									label={t("project.openCode")}
									onPress={() => {
										setTab("code");
										router.navigate("/");
									}}
								/>
							) : (
								<Muted>{t("project.pairSoCodeOpens")}</Muted>
							)}
						</Paper>
					) : null}
					{saveHint ? <Muted>{saveHint}</Muted> : null}
					<View style={{ gap: 10 }}>
						<PreviewCard
							title={t("project.pcb")}
							hint={t("project.noPcbHintDesktop")}
							url={bundle.pcbPreviewUrl}
						/>
						<BreadboardWebView
							diagramText={breadboardJson}
							previewUrl={bundle.breadboardPreviewUrl}
							livePins={livePins}
							arduinoLivePins={arduinoLivePins}
							verifyResults={verifyResults}
							boardModel={activeBoard?.status?.model}
						/>
						{modelParts.length > 0 ? (
							<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
								{modelParts.map((part) => {
									const active = part.name === activePart;
									return (
										<Pressable
											key={part.name}
											onPress={() => selectModelPart(part.name)}
											style={{
												borderWidth: 1,
												borderColor: active ? colors.primary : colors.border,
												borderRadius: 8,
												paddingHorizontal: 12,
												paddingVertical: 6,
												backgroundColor: active ? colors.chipBg : "transparent",
											}}
										>
											<Text
												style={{
													color: colors.text,
													fontWeight: "600",
												}}
											>
												{part.name}
											</Text>
											<Text style={{ color: colors.muted, fontSize: 12 }}>
												{part.fits
													.map((fit) => modelFitLabel(t, fit))
													.join(", ")}
											</Text>
										</Pressable>
									);
								})}
							</View>
						) : null}
						{modelGlb ? (
							<ModelWebView glbBase64={modelGlb} />
						) : (
							<Paper>
								<Muted>
									{modelParts.length
										? t("project.modelLoading")
										: t("project.noModel")}
								</Muted>
							</Paper>
						)}
					</View>
					<View style={{ gap: 8 }}>
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
							busy={sketchBusy || !token || !activeUuid}
							onLaunch={(dir) => {
								if (!token) {
									return;
								}
								launchSketch(async () => {
									await startRun(token, { uuid: activeUuid, dir });
									setRunRunning((await loadRun(token, activeUuid)).running);
								});
							}}
						/>
					</View>
				</Paper>
			) : loading || !configured || empty ? null : (
				<Muted>{t("project.selectToSee")}</Muted>
			)}
			{paired && activeUuid && bundle ? (
				<Paper>
					<Body>{t("project.boardTools")}</Body>
					<Muted>{t("project.boardToolsHint")}</Muted>
					<Muted>
						{t("project.selectedBoardContext", {
							board:
								activeBoard.device.label ||
								activeBoard.status?.model ||
								activeUuid.slice(0, 8),
						})}
					</Muted>
					<ErrorText>{t("project.safetyHint")}</ErrorText>
					<View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
						{boards.map((board) => (
							<Pressable
								key={board.device.uuid}
								onPress={() => selectBoard(board.device.uuid)}
								style={{
									borderWidth: 1,
									borderColor:
										activeUuid === board.device.uuid
											? colors.primary
											: colors.border,
									borderRadius: 999,
									paddingHorizontal: 10,
									paddingVertical: 6,
								}}
							>
								<Text
									style={{
										color:
											activeUuid === board.device.uuid
												? colors.primary
												: colors.text,
									}}
								>
									{board.device.label || board.device.uuid.slice(0, 8)}
								</Text>
							</Pressable>
						))}
					</View>
					<View style={{ gap: 8 }}>
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
							<FlashPanel
								uuid={activeUuid}
								project={bundle.repo}
								preselectDir={
									flashSketch?.project === bundle.repo
										? flashSketch.dir
										: undefined
								}
							/>
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
					</View>
				</Paper>
			) : null}
			<Modal
				visible={deleteOpen}
				animationType="fade"
				transparent
				onRequestClose={() => {
					if (!deleting) {
						setDeleteOpen(false);
					}
				}}
			>
				<View
					style={{
						flex: 1,
						backgroundColor: "rgba(0,0,0,0.5)",
						justifyContent: "center",
						padding: 24,
					}}
				>
					<View
						style={{
							backgroundColor: colors.surface,
							borderRadius: 16,
							padding: 16,
							gap: 12,
						}}
					>
						<Title>{t("project.deleteTitle")}</Title>
						<Body>
							{t("project.deleteConfirmHint", {
								name: pendingDelete?.name ?? "",
							})}
						</Body>
						<Field
							label={t("project.colName")}
							value={deleteName}
							onChangeText={setDeleteName}
							placeholder={pendingDelete?.name}
						/>
						<PrimaryButton
							label={
								deleting ? t("project.deleting") : t("project.deleteConfirm")
							}
							disabled={
								deleting ||
								!pendingDelete ||
								deleteName.trim() !== pendingDelete.name
							}
							onPress={() => void removeOpenedProject()}
						/>
						<TextButton
							label={t("project.cancel")}
							disabled={deleting}
							onPress={() => setDeleteOpen(false)}
						/>
					</View>
				</View>
			</Modal>
		</Screen>
	);
}

function modelFitLabel(t: ReturnType<typeof useT>, fit: string): string {
	if (fit === "companion-header") {
		return t("project.fitsCompanion");
	}
	if (fit === "arduino-uno") {
		return t("project.fitsUno");
	}
	if (fit === "arduino-nano") {
		return t("project.fitsNano");
	}
	if (fit === "arduino-mega") {
		return t("project.fitsMega");
	}
	return fit;
}
