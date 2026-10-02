import { useAudioPlayer } from "expo-audio";
import { useEffect, useState } from "react";
import { DeviceEventEmitter, Switch, View } from "react-native";
import { BOARD_PRESENCE_SOUND_KEY } from "../../../../packages/core/src/board-presence.ts";
import { useT } from "../lib/locale.tsx";
import { storageGet, storageSet } from "../lib/storage.ts";
import { Body, Muted, Paper, TextButton } from "./ui.tsx";

export default function BoardAlertSettings() {
	const t = useT();
	const [enabled, setEnabled] = useState(true);
	const online = useAudioPlayer(require("../../assets/board-online.wav"));
	const offline = useAudioPlayer(require("../../assets/board-offline.wav"));
	useEffect(() => {
		void storageGet(BOARD_PRESENCE_SOUND_KEY).then((value) =>
			setEnabled(value !== "0"),
		);
	}, []);
	function preview(isOnline: boolean) {
		online.pause();
		offline.pause();
		const player = isOnline ? online : offline;
		player.volume = 0.35;
		void player
			.seekTo(0)
			.then(() => player.play())
			.catch(() => undefined);
	}
	return (
		<Paper>
			<Body>{t("presence.title")}</Body>
			<Muted>{t("presence.description")}</Muted>
			<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
				<View style={{ flex: 1 }}>
					<Body>{t("presence.sounds")}</Body>
				</View>
				<Switch
					accessibilityLabel={t("presence.sounds")}
					value={enabled}
					onValueChange={(value) => {
						setEnabled(value);
						DeviceEventEmitter.emit(BOARD_PRESENCE_SOUND_KEY, value);
						void storageSet(BOARD_PRESENCE_SOUND_KEY, value ? "1" : "0");
					}}
				/>
			</View>
			<TextButton
				label={t("presence.previewOnline")}
				onPress={() => preview(true)}
			/>
			<TextButton
				label={t("presence.previewOffline")}
				onPress={() => preview(false)}
			/>
		</Paper>
	);
}
