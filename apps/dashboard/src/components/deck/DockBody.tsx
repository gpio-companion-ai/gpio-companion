import { GET as loadApp, POST as stopApp } from "@api/app";
import { GET as loadRun } from "@api/run";
import { POST as stopRun } from "@api/run/stop";
import FlashPanel from "@components/FlashPanel";
import FlashProxyButton from "@components/FlashProxyButton";
import GpioPanel from "@components/GpioPanel";
import RunPanel from "@components/RunPanel";
import VerifyPanel from "@components/VerifyPanel";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import type { AppStatus, RunStatus } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useConsoleTunnel } from "../../hooks/useConsoleTunnel.ts";
import { useDashboardMode } from "../../hooks/useDashboardMode.tsx";
import { useDeviceHub } from "../../hooks/useDeviceHub.ts";
import { useT } from "../../hooks/useLocale.tsx";
import { useWorkbench } from "../../hooks/useWorkbench.tsx";
import { unwrapAction } from "../../lib/action.ts";

export default function DockBody() {
	const t = useT();
	const { isEasy } = useDashboardMode();
	const { uuid } = useBoardSelection();
	const {
		boards,
		refreshBoards,
		project,
		flashSketch,
		dockTab,
		setLivePins,
		setVerifyResults,
		setConsoleStatus,
	} = useWorkbench();
	const board = boards.find((item) => item.uuid === uuid);
	// Fleet status is a one-shot GET /v1/status probe loaded once per session.
	// A missing entry means "unknown" (still loading or stale), not offline:
	// pass undefined so GpioPanel attempts the live tunnel instead of showing
	// "Board not connected" while the Devices page already sees it online.
	const online = Boolean(board?.online);
	const gpioConnected = board ? board.online : undefined;

	// Refresh fleet status when the Live GPIO dock opens or the board changes,
	// so a board that came online after the initial probe is not stuck offline.
	useEffect(() => {
		if (dockTab === "gpio" && uuid) {
			refreshBoards();
		}
	}, [dockTab, uuid, refreshBoards]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset live state when the selected board changes
	useEffect(() => {
		setLivePins({});
		setVerifyResults([]);
		setConsoleStatus("idle");
	}, [setConsoleStatus, setLivePins, setVerifyResults, uuid]);

	if (!uuid) {
		return <span>{t("deck.dock.needBoard")}</span>;
	}

	if (dockTab === "gpio") {
		if (isEasy) {
			return <span>{t("deck.dock.gpioExpert")}</span>;
		}
		return (
			<GpioPanel
				key={uuid}
				uuid={uuid}
				poll
				connected={gpioConnected}
				onLivePins={setLivePins}
				onRetry={refreshBoards}
			/>
		);
	}

	if (dockTab === "flash") {
		const proxy = <FlashProxyButton uuid={uuid} connected={online} />;
		const preselectDir = flashSketch?.dir;
		const preselectProject = project || flashSketch?.project;
		if (!isEasy) {
			return (
				<>
					{proxy}
					<FlashPanel
						uuid={uuid}
						project={preselectProject}
						preselectDir={preselectDir}
					/>
				</>
			);
		}
		return (
			<>
				<DockTool title={t("flash.title")} startOpen>
					{proxy}
					<FlashPanel
						uuid={uuid}
						project={preselectProject}
						preselectDir={preselectDir}
					/>
				</DockTool>
				<DockTool title={t("verify.title")}>
					<VerifyPanel
						uuid={uuid}
						project={project}
						onResults={setVerifyResults}
					/>
				</DockTool>
			</>
		);
	}

	if (dockTab === "problems") {
		return (
			<VerifyPanel uuid={uuid} project={project} onResults={setVerifyResults} />
		);
	}

	if (dockTab === "actions") {
		return <DockActions uuid={uuid} online={online} />;
	}

	return (
		<>
			<DockConsole uuid={uuid} />
			<div hidden>
				<RunPanel uuid={uuid} project={project} watchConsole={false} />
			</div>
		</>
	);
}

function DockTool({
	title,
	startOpen = false,
	children,
}: {
	title: string;
	startOpen?: boolean;
	children: ReactNode;
}) {
	const [open, setOpen] = useState(startOpen);
	return (
		<details
			className={`b6-tool${open ? " is-open" : ""}`}
			open={open}
			onToggle={(event) => setOpen(event.currentTarget.open)}
		>
			<summary>{title}</summary>
			{open ? children : null}
		</details>
	);
}

function DockConsole({ uuid }: { uuid: string }) {
	const t = useT();
	const { setConsoleStatus } = useWorkbench();
	const tunnel = useConsoleTunnel(uuid);
	const logRef = useRef<HTMLPreElement>(null);
	const log = tunnel.snapshot.host.log;

	useEffect(() => {
		setConsoleStatus(tunnel.status);
		return () => setConsoleStatus("idle");
	}, [setConsoleStatus, tunnel.status]);

	useEffect(() => {
		const node = logRef.current;
		if (!node || log.length < 0) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [log]);

	return (
		<div className="b6-console">
			<div className="b6-console-bar">
				<button
					type="button"
					className="b6-console-clear"
					disabled={!log}
					onClick={tunnel.clear}
				>
					{t("deck.dock.consoleClear")}
				</button>
			</div>
			<pre ref={logRef} className={log ? undefined : "is-empty"}>
				{log || t("deck.dock.consoleEmpty")}
			</pre>
		</div>
	);
}

function DockActions({ uuid, online }: { uuid: string; online: boolean }) {
	const t = useT();
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState("");
	const [running, setRunning] = useState<boolean | null>(null);
	const [appStatus, setAppStatus] = useState<AppStatus | null>(null);
	const [appStopping, setAppStopping] = useState(false);

	useEffect(() => {
		setRunning(null);
		setAppStatus(null);
		let cancelled = false;
		loadRun(uuid)
			.then((result) => {
				if (cancelled) {
					return;
				}
				setRunning(unwrapAction(result).running);
			})
			.catch(() => {
				if (!cancelled) {
					setRunning(null);
				}
			});
		loadApp(uuid)
			.then((result) => {
				if (!cancelled) {
					setAppStatus(unwrapAction(result));
				}
			})
			.catch(() => {
				if (!cancelled) {
					setAppStatus(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [uuid]);

	useDeviceHub(uuid, {
		onRun: (status: RunStatus) => setRunning(status.running),
	});

	async function stopSketch() {
		if (!uuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			unwrapAction(await stopRun(uuid));
			setRunning(unwrapAction(await loadRun(uuid)).running);
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

	async function stopCustomServer() {
		if (!uuid || appStopping) {
			return;
		}
		setError("");
		setAppStopping(true);
		try {
			unwrapAction(await stopApp({ uuid, stop: true }));
			setAppStatus(unwrapAction(await loadApp(uuid)));
		} catch (err) {
			setError(
				translateError(
					t,
					err instanceof Error ? err.message : "failed to stop custom server",
				),
			);
		} finally {
			setAppStopping(false);
		}
	}

	const runRunning = running === true;
	const appRunning = appStatus?.running === true;

	return (
		<Stack spacing={1}>
			<Typography variant="body2" color="secondary">
				{runRunning
					? t("deck.dock.runRunning")
					: online
						? t("deck.dock.runIdle")
						: null}
			</Typography>
			<Typography variant="body2" color="secondary">
				{appRunning
					? t("deck.dock.appRunning", { name: appStatus?.name ?? "" })
					: t("deck.dock.appIdle")}
			</Typography>
			{error ? <Alert severity="error">{error}</Alert> : null}
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="outlined"
					color={runRunning ? "error" : "primary"}
					disabled={stopping || !runRunning}
					onClick={() => void stopSketch()}
				>
					{stopping ? t("deck.dock.stopping") : t("deck.dock.stopSketch")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					color={appRunning ? "error" : "primary"}
					disabled={appStopping || !appRunning}
					onClick={() => void stopCustomServer()}
				>
					{appStopping ? t("deck.dock.stopping") : t("deck.dock.stopApp")}
				</Button>
			</Stack>
		</Stack>
	);
}
