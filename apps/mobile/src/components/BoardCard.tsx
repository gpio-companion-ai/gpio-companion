import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { useState } from "react";
import { Alert, Linking, Pressable, Text, View } from "react-native";
import {
	type BoardView,
	deviceDisplayName,
	patchDeviceLabel,
	startCliLogin,
} from "../lib/api.ts";
import { useAuth } from "../lib/auth.tsx";
import { useColors } from "../lib/color-mode.tsx";
import { useDashboardMode } from "../lib/dashboard-mode.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { useT } from "../lib/locale.tsx";
import CompanionInfo from "./CompanionInfo.tsx";
import GpioPanel from "./GpioPanel.tsx";
import { Chip, Field, Paper, PrimaryButton, Row, TextButton } from "./ui.tsx";

export default function BoardCard({
	board,
	selected,
	onSelect,
	onUnpair,
	onLabelSaved,
}: {
	board: BoardView;
	selected?: boolean;
	onSelect?: (uuid: string) => void;
	onUnpair?: (uuid: string) => void;
	onLabelSaved?: (uuid: string, label: string) => void;
}) {
	const auth = useAuth();
	const t = useT();
	const colors = useColors();
	const { isEasy } = useDashboardMode();
	const { setTab } = useDeviceHub();
	const { device, status } = board;
	const online = Boolean(status);
	const networkLabel =
		status?.network?.type === "ethernet"
			? t("devices.ethernet")
			: status?.network?.type === "wifi"
				? status.network.ssid?.trim()
					? t("devices.wifiSsid", { ssid: status.network.ssid.trim() })
					: t("nav.wifi")
				: "";
	const [label, setLabel] = useState(device.label ?? "");
	const [saving, setSaving] = useState(false);
	const [open, setOpen] = useState(false);
	const expanded = open;
	const summaryMeta = [
		status?.model || status?.hardware || device.uuid.slice(0, 8),
		networkLabel || "",
		selected ? t("devices.selected") : "",
	]
		.filter(Boolean)
		.join(" • ");

	async function saveLabel() {
		if (!auth.token) {
			return;
		}
		setSaving(true);
		try {
			await patchDeviceLabel(auth.token, device.uuid, label);
			onLabelSaved?.(device.uuid, label);
		} finally {
			setSaving(false);
		}
	}

	function toggle() {
		const next = !open;
		setOpen(next);
		if (next && onSelect) {
			onSelect(device.uuid);
		}
	}

	return (
		<Paper selected={selected}>
			<Pressable
				onPress={toggle}
				style={{
					flexDirection: "row",
					alignItems: "center",
					gap: 10,
					minHeight: 48,
				}}
				accessibilityRole="button"
				accessibilityState={{ expanded }}
			>
				<View
					style={{
						width: 34,
						height: 34,
						borderRadius: 10,
						backgroundColor: colors.chipBg,
						alignItems: "center",
						justifyContent: "center",
					}}
				>
					<MaterialIcons name="memory" size={20} color={colors.primary} />
				</View>
				<View style={{ flex: 1, minWidth: 0 }}>
					<Text
						style={{ color: colors.text, fontWeight: "700", fontSize: 16 }}
						numberOfLines={1}
					>
						{deviceDisplayName(device)}
					</Text>
					<Text style={{ color: colors.muted, fontSize: 12 }} numberOfLines={1}>
						{summaryMeta}
					</Text>
				</View>
				<View
					style={{
						width: 9,
						height: 9,
						borderRadius: 999,
						backgroundColor: online ? colors.success : colors.muted,
					}}
				/>
				<MaterialIcons
					name={expanded ? "expand-less" : "expand-more"}
					size={22}
					color={colors.muted}
				/>
			</Pressable>
			{expanded ? (
				<View style={{ gap: 8 }}>
					{selected ? (
						<Chip label={t("devices.selected")} tone="success" />
					) : (
						<PrimaryButton
							label={t("devices.selectBoard")}
							onPress={() => onSelect?.(device.uuid)}
						/>
					)}
					{isEasy ? null : (
						<>
							<Text style={{ color: colors.muted }} selectable>
								{device.uuid}
							</Text>
							{device.deviceUrl ? (
								<Text style={{ color: colors.muted }} selectable>
									{device.deviceUrl}
								</Text>
							) : null}
						</>
					)}
					<Field
						label={t("devices.label")}
						value={label}
						onChangeText={setLabel}
						placeholder={t("devices.optionalName")}
					/>
					<TextButton
						label={saving ? t("project.saving") : t("devices.save")}
						disabled={saving}
						onPress={() => void saveLabel()}
					/>
					<Row>
						{status?.model || status?.hardware ? (
							<Chip label={status?.model || status?.hardware || ""} />
						) : null}
						{networkLabel ? <Chip label={networkLabel} /> : null}
						{status && !isEasy ? (
							<Chip
								label={
									status.tunnel?.configured
										? t("devices.tunnelReady")
										: t("devices.tunnelPending")
								}
								tone={status.tunnel?.configured ? "success" : "muted"}
							/>
						) : null}
						{status ? (
							<>
								<Chip
									label={
										status.secrets?.githubReady
											? t("devices.githubReady")
											: t("devices.githubKeysPending")
									}
									tone={status.secrets?.githubReady ? "success" : "warning"}
								/>
							</>
						) : null}
					</Row>
					{isEasy ? null : (
						<CompanionInfo key={device.uuid} uuid={device.uuid} />
					)}
					{isEasy || !selected ? null : (
						<GpioPanel
							key={`${device.uuid}-gpio`}
							uuid={device.uuid}
							connected={Boolean(status)}
						/>
					)}
					<Row>
						<TextButton
							label={t("project.openCode")}
							onPress={() => setTab("code")}
						/>
						<CliAuthButton uuid={device.uuid} />
						{!isEasy && onUnpair ? (
							<TextButton
								danger
								label={t("devices.unpair")}
								onPress={() => {
									Alert.alert(
										t("devices.unpairTitle"),
										`${t("devices.unpairConfirm")}\n\n${t("devices.unpairDetail")}`,
										[
											{ text: t("admin.cancel"), style: "cancel" },
											{
												text: t("devices.unpair"),
												style: "destructive",
												onPress: () => onUnpair(device.uuid),
											},
										],
									);
								}}
							/>
						) : null}
					</Row>
				</View>
			) : null}
		</Paper>
	);
}

function CliAuthButton({ uuid }: { uuid: string }) {
	const t = useT();
	const auth = useAuth();
	const [busy, setBusy] = useState(false);

	async function start() {
		if (!auth.token) return;
		setBusy(true);
		try {
			const started = await startCliLogin(auth.token, uuid);
			await Linking.openURL(started.authorizeUrl);
		} catch (caught) {
			Alert.alert(
				t("devices.authenticateCli"),
				caught instanceof Error ? caught.message : "cli login failed",
			);
		} finally {
			setBusy(false);
		}
	}

	return (
		<TextButton
			label={
				busy ? t("devices.authenticatingCli") : t("devices.authenticateCli")
			}
			onPress={() => void start()}
		/>
	);
}
