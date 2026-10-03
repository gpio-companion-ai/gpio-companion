import { GET as loadApp, POST as startApp } from "@api/app";
import { GET as loadApps } from "@api/app/list";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import type { AppStatus, BoardApp } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useMemo, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { unwrapAction } from "../lib/action.ts";
import { openBoardAppInCode } from "../lib/ui-app.ts";

export default function AppPanel({
	uuid,
	project,
}: {
	uuid: string;
	project?: string;
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
		loadApps(uuid)
			.then((result) => {
				if (!cancelled) {
					setApps(unwrapAction(result).apps);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setApps([]);
				}
			});
		loadApp(uuid)
			.then((result) => {
				if (!cancelled) {
					setStatus(unwrapAction(result));
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

	async function refreshStatus() {
		try {
			setStatus(unwrapAction(await loadApp(uuid)));
		} catch {
			setStatus(null);
		}
	}

	async function start() {
		if (!selected || busy) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			await startApp({
				uuid,
				repo: selected.project,
				dir: selected.dir,
			});
			await refreshStatus();
		} catch (caught) {
			setError(
				translateError(
					t,
					caught instanceof Error ? caught.message : "request failed",
				),
			);
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
					onClick={() => {
						if (selected) {
							openBoardAppInCode(selected.name, selected.name);
						}
					}}
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
