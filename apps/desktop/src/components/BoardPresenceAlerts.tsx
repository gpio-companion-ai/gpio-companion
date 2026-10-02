import Snackbar from "@shpaw415/mui-lite/Snackbar";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	type BoardPresence,
	BoardPresenceTracker,
} from "../../../../packages/core/src/board-presence.ts";
import { createPresenceAudio } from "../../../../packages/core/src/board-presence-audio.ts";
import { useDeviceHub } from "../hooks/useDeviceHub";
import { useT } from "../locale";

type Board = { uuid: string; name: string };
function WatchBoard({
	board,
	onChange,
}: {
	board: Board;
	onChange: (board: Board, online: boolean) => void;
}) {
	const latest = useRef({ board, onChange });
	latest.current = { board, onChange };
	const tracker = useRef(new BoardPresenceTracker());
	const onPresence = useCallback((presence: BoardPresence) => {
		if (tracker.current.accept(presence))
			latest.current.onChange(latest.current.board, presence.online);
	}, []);
	useDeviceHub(board.uuid, { onPresence });
	return null;
}

export default function BoardPresenceAlerts({
	boards,
	onChangeStatus,
}: {
	boards: Board[];
	onChangeStatus: () => void;
}) {
	const t = useT();
	const [alerts, setAlerts] = useState<string[]>([]);
	const audio = useRef<ReturnType<typeof createPresenceAudio> | null>(null);
	useEffect(() => {
		const player = createPresenceAudio(
			new URL("../../../../sounds/board-online.wav", import.meta.url).href,
			new URL("../../../../sounds/board-offline.wav", import.meta.url).href,
		);
		audio.current = player;
		return () => {
			player.dispose();
			audio.current = null;
		};
	}, []);
	useEffect(() => {
		if (!alerts.length) return;
		const timer = window.setTimeout(
			() => setAlerts((items) => items.slice(1)),
			4000,
		);
		return () => window.clearTimeout(timer);
	}, [alerts]);
	function onChange(board: Board, online: boolean) {
		onChangeStatus();
		setAlerts((items) => [
			...items,
			t(online ? "presence.online" : "presence.offline", { name: board.name }),
		]);
		audio.current?.play(online);
	}
	return (
		<>
			{boards.map((board) => (
				<WatchBoard key={board.uuid} board={board} onChange={onChange} />
			))}
			<Snackbar
				open={alerts.length > 0}
				onClose={() => setAlerts((items) => items.slice(1))}
				message={alerts[0] ?? ""}
			/>
		</>
	);
}
