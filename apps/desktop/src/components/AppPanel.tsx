import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useMemo, useState } from "react";
import {
	type AppStatus,
	type BoardApp,
	loadAppStatus,
	loadBoardApps,
	startApp,
} from "../api";
import { useT } from "../locale";

export default function AppPanel({
	uuid,
	project,
	onOpenCode,
}: {
	uuid: string;
	project?: string;
	onOpenCode?: () => void;
}) {
	const t = useT();
	const [apps, setApps] = useState<BoardApp[]>([]);
	const [status, setStatus] = useState<AppStatus | null>(null);
	const [dir, setDir] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");

	const listed = useMemo(
		() => apps.filter((item) => !project || item.project === project),
		[apps, project],
	);

	useEffect(() => {
		if (!uuid) {
			setApps([]);
			setStatus(null);
			return;
		}
		let cancelled = false;
		loadBoardApps(uuid)
			.then((result) => {
				if (!cancelled) {
					setApps(result.apps);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setApps([]);
				}
			});
		loadAppStatus(uuid)
			.then((result) => {
				if (!cancelled) {
					setStatus(result);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setStatus(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [uuid]);

	useEffect(() => {
		if (!listed.some((item) => item.dir === dir)) {
			setDir(listed[0]?.dir ?? "");
		}
	}, [listed, dir]);

	const selected = listed.find((item) => item.dir === dir) ?? null;
	const runningSelected =
		Boolean(status?.running) && status?.name === selected?.name;

	function openInPreview() {
		if (!selected) {
			return;
		}
		onOpenCode?.();
		const detail = { appId: selected.name, title: selected.name };
		try {
			(window as unknown as { __gpioUiApp?: typeof detail }).__gpioUiApp =
				detail;
			window.dispatchEvent(new CustomEvent("gpio-ui-app", { detail }));
		} catch {
			undefined;
		}
	}

	async function start() {
		if (!selected || busy) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			await startApp({ uuid, repo: selected.project, dir: selected.dir });
			setStatus(await loadAppStatus(uuid));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Stack spacing={1}>
			<Typography variant="subtitle1">{t("project.customServer")}</Typography>
			{!project ? (
				<Typography color="secondary" variant="body2">
					{t("run.selectProject")}
				</Typography>
			) : listed.length === 0 ? (
				<Typography color="secondary" variant="body2">
					{t("project.appNone")}
				</Typography>
			) : (
				<Select
					name="board-app"
					label={t("project.appSelect")}
					value={dir}
					onSelect={setDir}
					className="w-full"
				>
					{listed.map((item) => (
						<option key={`${item.project}/${item.dir}`} value={item.dir}>
							{item.name}
						</option>
					))}
				</Select>
			)}
			<Stack direction="row" spacing={1} className="flex-wrap">
				<Button
					type="button"
					variant="contained"
					size="small"
					disabled={busy || !uuid || !selected}
					onClick={() => void start()}
				>
					{busy ? t("project.appStarting") : t("project.appStart")}
				</Button>
				<Button
					type="button"
					variant="outlined"
					size="small"
					disabled={busy || !runningSelected || !selected}
					onClick={openInPreview}
				>
					{t("project.appOpen")}
				</Button>
			</Stack>
			{error ? <Alert severity="error">{error}</Alert> : null}
			<Typography color="secondary" variant="body2">
				{status?.running
					? t("project.appRunning", { name: status.name ?? "" })
					: t("project.appIdle")}
			</Typography>
		</Stack>
	);
}
