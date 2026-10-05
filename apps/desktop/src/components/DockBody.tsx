import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type AppStatus,
	loadAppStatus,
	loadRun,
	type RunStatus,
	stopApp,
	stopRun,
} from "../api";
import { useBoardSelection } from "../hooks/useBoardSelection";
import type { ConsoleTunnelStatus } from "../hooks/useConsoleTunnel";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { useDeviceHub } from "../hooks/useDeviceHub";
import { useT } from "../locale";
import FlashPanel from "./FlashPanel";
import FlashProxyButton from "./FlashProxyButton";
import GpioPanel from "./GpioPanel";
import SshPanel from "./SshPanel";
import SupportChat from "./SupportChat";
import VerifyPanel from "./VerifyPanel";

export type DesktopDockTab =
	| "console"
	| "gpio"
	| "flash"
	| "problems"
	| "actions"
	| "ssh"
	| "support";

export default function DockBody({
	tab,
	uuid,
	log,
	status,
	clear,
	connected,
}: {
	tab: DesktopDockTab;
	uuid: string;
	log: string;
	status: ConsoleTunnelStatus;
	clear: () => void;
	connected?: boolean;
}) {
	const t = useT();
	const { isEasy } = useDashboardMode();
	const { flashSketch } = useBoardSelection();
	const logRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		const node = logRef.current;
		if (!node || log.length < 0) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [log]);

	if (tab === "support") {
		return <SupportChat />;
	}
	if (!uuid) {
		return <span>{t("deck.dock.needBoard")}</span>;
	}
	if (tab === "gpio") {
		if (isEasy) {
			return <span>{t("deck.dock.gpioExpert")}</span>;
		}
		return <GpioPanel key={uuid} uuid={uuid} poll connected />;
	}
	if (tab === "flash") {
		return (
			<div className="b6-dock-stack">
				<FlashProxyButton uuid={uuid} connected={connected} />
				<FlashPanel
					uuid={uuid}
					project={flashSketch?.project}
					preselectDir={flashSketch?.dir}
				/>
			</div>
		);
	}
	if (tab === "problems") {
		return <VerifyPanel uuid={uuid} />;
	}
	if (tab === "actions") {
		return <DockActions uuid={uuid} online={Boolean(connected)} />;
	}
	if (tab === "ssh") {
		return <SshPanel uuid={uuid} />;
	}
	return (
		<div className="b6-dock-console">
			<div className="b6-dock-console-bar">
				<button
					type="button"
					className="b6-dock-console-clear"
					disabled={!log}
					onClick={clear}
				>
					{t("deck.dock.consoleClear")}
				</button>
			</div>
			<pre
				ref={logRef}
				className={log ? "b6-console-log" : "b6-console-log is-empty"}
				data-status={status}
			>
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
				if (!cancelled) {
					setRunning(result.running);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setRunning(null);
				}
			});
		loadAppStatus(uuid)
			.then((result) => {
				if (!cancelled) {
					setAppStatus(result);
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

	const onRun = useCallback((status: RunStatus) => {
		setRunning(status.running);
	}, []);
	useDeviceHub(uuid, { onRun });

	async function stopSketch() {
		if (!uuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			await stopRun(uuid);
			setRunning((await loadRun(uuid)).running);
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "failed to stop sketch",
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
			await stopApp(uuid);
			setAppStatus(await loadAppStatus(uuid));
		} catch (caught) {
			setError(
				caught instanceof Error
					? caught.message
					: "failed to stop custom server",
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
					size="small"
					color={runRunning ? "error" : "primary"}
					disabled={stopping || !runRunning}
					onClick={() => void stopSketch()}
				>
					{stopping ? t("deck.dock.stopping") : t("deck.dock.stopSketch")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					size="small"
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
