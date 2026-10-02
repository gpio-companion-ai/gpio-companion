import Snackbar from "@shpaw415/mui-lite/Snackbar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type BoardPresence,
	BoardPresenceTracker,
} from "../../../../packages/core/src/board-presence.ts";
import { createPresenceAudio } from "../../../../packages/core/src/board-presence-audio.ts";
import { useDeviceHub } from "../hooks/useDeviceHub.ts";
import { useT } from "../hooks/useLocale.tsx";

type Board = { uuid: string; name: string };
function WatchBoard({
	board,
	onChange,
	onStatus,
}: {
	board: Board;
	onChange: (board: Board, online: boolean) => void;
	onStatus: (uuid: string, online: boolean) => void;
}) {
	const latest = useRef({ board, onChange, onStatus });
	latest.current = { board, onChange, onStatus };
	const tracker = useRef(new BoardPresenceTracker());
	const onPresence = useCallback((presence: BoardPresence) => {
		latest.current.onStatus(presence.uuid, presence.online);
		if (tracker.current.accept(presence))
			latest.current.onChange(latest.current.board, presence.online);
	}, []);
	useDeviceHub(board.uuid, { onPresence });
	return null;
}

export default function BoardPresenceAlerts({
	boards,
	enabled,
	onStatus,
}: {
	boards: Board[];
	enabled: boolean;
	onStatus: (uuid: string, online: boolean) => void;
}) {
	const t = useT();
	const [alerts, setAlerts] = useState<string[]>([]);
	const audio = useRef<ReturnType<typeof createPresenceAudio> | null>(null);
	useEffect(() => {
		if (!enabled) {
			setAlerts([]);
			return;
		}
		const player = createPresenceAudio(
			"/assets/board-online.wav",
			"/assets/board-offline.wav",
		);
		audio.current = player;
		return () => {
			player.dispose();
			audio.current = null;
		};
	}, [enabled]);
	useEffect(() => {
		if (!alerts.length) return;
		const timer = window.setTimeout(
			() => setAlerts((items) => items.slice(1)),
			4000,
		);
		return () => window.clearTimeout(timer);
	}, [alerts]);
	function onChange(board: Board, online: boolean) {
		setAlerts((items) => [
			...items,
			t(online ? "presence.online" : "presence.offline", { name: board.name }),
		]);
		audio.current?.play(online);
	}
	return (
		<>
			{enabled &&
				boards.map((board) => (
					<WatchBoard
						key={board.uuid}
						board={board}
						onChange={onChange}
						onStatus={onStatus}
					/>
				))}
			<Snackbar
				open={alerts.length > 0}
				onClose={() => setAlerts((items) => items.slice(1))}
				message={alerts[0] ?? ""}
			/>
		</>
	);
}
