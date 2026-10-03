import { useEffect, useMemo, useState } from "react";
import { DeviceEventEmitter, Pressable, Text, View } from "react-native";
import {
	type AppStatus,
	type BoardApp,
	loadAppStatus,
	loadBoardApps,
	startApp,
} from "../lib/api";
import { useColors } from "../lib/color-mode";
import { useT } from "../lib/locale";
import { setPendingUiApp } from "../lib/ui-app";
import { ErrorText } from "./ui";

type Props = {
	token: string | null;
	uuid: string;
	project?: string;
	onOpenCode?: () => void;
};

export default function AppPanel({ token, uuid, project, onOpenCode }: Props) {
	const t = useT();
	const colors = useColors();
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
		if (!token || !uuid) {
			setApps([]);
			setStatus(null);
			return;
		}
		let cancelled = false;
		void loadBoardApps(token, uuid)
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
		void loadAppStatus(token, uuid)
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
	}, [token, uuid]);

	useEffect(() => {
		if (!listed.some((item) => item.dir === dir)) {
			setDir(listed[0]?.dir ?? "");
		}
	}, [listed, dir]);

	const selected = listed.find((item) => item.dir === dir) ?? null;
	const runningSelected =
		Boolean(status?.running) && status?.name === selected?.name;

	async function start() {
		if (!token || !uuid || !selected || busy) {
			return;
		}
		setBusy(true);
		setError("");
		try {
			await startApp(token, {
				uuid,
				repo: selected.project,
				dir: selected.dir,
			});
			setStatus(await loadAppStatus(token, uuid));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	function openInPreview() {
		if (!selected) {
			return;
		}
		onOpenCode?.();
		const detail = { appId: selected.name, title: selected.name };
		setPendingUiApp(detail);
		DeviceEventEmitter.emit("gpio-ui-app", detail);
	}

	return (
		<View style={{ gap: 8 }}>
			<Text style={{ color: colors.muted, fontSize: 12 }}>
				{t("project.appHint")}
			</Text>
			{!project ? (
				<Text style={{ color: colors.muted, fontSize: 13 }}>
					{t("run.selectProject")}
				</Text>
			) : listed.length === 0 ? (
				<Text style={{ color: colors.muted, fontSize: 13 }}>
					{t("project.appNone")}
				</Text>
			) : (
				<View style={{ gap: 4 }}>
					{listed.map((item) => (
						<Pressable
							key={`${item.project}/${item.dir}`}
							onPress={() => setDir(item.dir)}
							accessibilityRole="button"
							accessibilityState={{ selected: item.dir === dir }}
							style={{
								minHeight: 44,
								justifyContent: "center",
								paddingHorizontal: 10,
								borderRadius: 8,
								borderWidth: 1,
								borderColor: item.dir === dir ? colors.primary : colors.border,
							}}
						>
							<Text
								style={{
									color: item.dir === dir ? colors.primary : colors.text,
									fontSize: 14,
								}}
							>
								{item.name}
							</Text>
						</Pressable>
					))}
				</View>
			)}
			<View style={{ flexDirection: "row", gap: 8, flexWrap: "wrap" }}>
				<Pressable
					onPress={() => void start()}
					disabled={busy || !uuid || !selected}
					accessibilityRole="button"
					style={{
						minHeight: 44,
						justifyContent: "center",
						paddingHorizontal: 14,
						borderRadius: 10,
						backgroundColor: busy || !selected ? colors.border : colors.primary,
					}}
				>
					<Text
						style={{
							color: busy || !selected ? colors.muted : colors.surface,
							fontSize: 14,
						}}
					>
						{busy ? t("project.appStarting") : t("project.appStart")}
					</Text>
				</Pressable>
				<Pressable
					onPress={openInPreview}
					disabled={!runningSelected || !selected}
					accessibilityRole="button"
					style={{
						minHeight: 44,
						justifyContent: "center",
						paddingHorizontal: 14,
						borderRadius: 10,
						borderWidth: 1,
						borderColor: runningSelected ? colors.primary : colors.border,
					}}
				>
					<Text
						style={{
							color: runningSelected ? colors.primary : colors.muted,
							fontSize: 14,
						}}
					>
						{t("project.appOpen")}
					</Text>
				</Pressable>
			</View>
			{error ? <ErrorText>{error}</ErrorText> : null}
			<Text style={{ color: colors.muted, fontSize: 12 }}>
				{status?.running
					? t("project.appRunning", { name: status.name ?? "" })
					: t("project.appIdle")}
			</Text>
		</View>
	);
}
