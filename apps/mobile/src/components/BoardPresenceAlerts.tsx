import { useAudioPlayer } from "expo-audio";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	AppState,
	DeviceEventEmitter,
	Pressable,
	Text,
	View,
} from "react-native";
import {
	BOARD_PRESENCE_SOUND_KEY,
	type BoardPresence,
	BoardPresenceTracker,
} from "../../../../packages/core/src/board-presence.ts";
import { useColorMode } from "../lib/color-mode.tsx";
import { useT } from "../lib/locale.tsx";
import { storageGet } from "../lib/storage.ts";
import { useDeviceHub } from "../lib/use-device-hub.ts";

type Board = { uuid: string; name: string };
function WatchBoard({
	board,
	token,
	onChange,
}: {
	board: Board;
	token: string;
	onChange: (board: Board, online: boolean) => void;
}) {
	const latest = useRef({ board, onChange });
	latest.current = { board, onChange };
	const tracker = useRef(new BoardPresenceTracker());
	const onPresence = useCallback((presence: BoardPresence) => {
		if (tracker.current.accept(presence) && AppState.currentState === "active")
			latest.current.onChange(latest.current.board, presence.online);
	}, []);
	useDeviceHub(board.uuid, token, { onPresence });
	return null;
}

export default function BoardPresenceAlerts({
	boards,
	token,
	onChangeStatus,
}: {
	boards: Board[];
	token: string | null | undefined;
	onChangeStatus: () => void;
}) {
	const t = useT();
	const { colors } = useColorMode();
	const [alerts, setAlerts] = useState<string[]>([]);
	const soundEnabled = useRef(true);
	useEffect(() => {
		let active = true;
		void storageGet(BOARD_PRESENCE_SOUND_KEY).then((value) => {
			if (active) soundEnabled.current = value !== "0";
		});
		const sub = DeviceEventEmitter.addListener(
			BOARD_PRESENCE_SOUND_KEY,
			(value: boolean) => {
				soundEnabled.current = value;
			},
		);
		return () => {
			active = false;
			sub.remove();
		};
	}, []);
	const onlineAudio = useAudioPlayer(require("../../assets/board-online.wav"));
	const offlineAudio = useAudioPlayer(
		require("../../assets/board-offline.wav"),
	);
	useEffect(() => {
		onlineAudio.volume = 0.35;
		offlineAudio.volume = 0.35;
		const sub = AppState.addEventListener("change", (state) => {
			if (state !== "active") {
				onlineAudio.pause();
				offlineAudio.pause();
				setAlerts([]);
			}
		});
		return () => sub.remove();
	}, [onlineAudio, offlineAudio]);
	useEffect(() => {
		if (!alerts.length) return;
		const timer = setTimeout(() => setAlerts((items) => items.slice(1)), 4000);
		return () => clearTimeout(timer);
	}, [alerts]);
	function onChange(board: Board, online: boolean) {
		onChangeStatus();
		setAlerts((items) => [
			...items,
			t(online ? "presence.online" : "presence.offline", { name: board.name }),
		]);
		onlineAudio.pause();
		offlineAudio.pause();
		if (!soundEnabled.current) return;
		const player = online ? onlineAudio : offlineAudio;
		void player
			.seekTo(0)
			.then(() => player.play())
			.catch(() => undefined);
	}
	return (
		<>
			{token &&
				boards.map((board) => (
					<WatchBoard
						key={board.uuid}
						board={board}
						token={token}
						onChange={onChange}
					/>
				))}
			{alerts.length > 0 && (
				<View
					pointerEvents="box-none"
					style={{
						position: "absolute",
						bottom: 96,
						left: 16,
						right: 16,
						zIndex: 1000,
					}}
				>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("presence.dismiss")}
						onPress={() => setAlerts((items) => items.slice(1))}
						style={{
							backgroundColor: colors.surface,
							borderColor: colors.border,
							borderWidth: 1,
							borderRadius: 12,
							padding: 16,
						}}
					>
						<Text
							accessibilityLiveRegion="polite"
							style={{ color: colors.text }}
						>
							{alerts[0]}
						</Text>
					</Pressable>
				</View>
			)}
		</>
	);
}
