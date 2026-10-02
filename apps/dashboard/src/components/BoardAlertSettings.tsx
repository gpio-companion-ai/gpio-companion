import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useRef, useState } from "react";
import { BOARD_PRESENCE_SOUND_KEY } from "../../../../packages/core/src/board-presence.ts";
import { createPresenceAudio } from "../../../../packages/core/src/board-presence-audio.ts";
import { useT } from "../hooks/useLocale.tsx";

export default function BoardAlertSettings() {
	const t = useT();
	const [enabled, setEnabled] = useState(true);
	const audio = useRef<ReturnType<typeof createPresenceAudio> | null>(null);
	useEffect(() => {
		try {
			setEnabled(localStorage.getItem(BOARD_PRESENCE_SOUND_KEY) !== "0");
		} catch {
			/* Use default. */
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
	}, []);
	return (
		<Paper className="w-full p-3" elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("presence.title")}</Typography>
				<Typography color="secondary">{t("presence.description")}</Typography>
				<label>
					<input
						type="checkbox"
						checked={enabled}
						onChange={(event) => {
							setEnabled(event.target.checked);
							try {
								localStorage.setItem(
									BOARD_PRESENCE_SOUND_KEY,
									event.target.checked ? "1" : "0",
								);
							} catch {
								/* Storage may be unavailable. */
							}
						}}
					/>{" "}
					{t("presence.sounds")}
				</label>
				<Stack direction="row" spacing={1} className="flex-wrap">
					<Button
						variant="outlined"
						size="small"
						onClick={() => audio.current?.play(true, true)}
					>
						{t("presence.previewOnline")}
					</Button>
					<Button
						variant="outlined"
						size="small"
						onClick={() => audio.current?.play(false, true)}
					>
						{t("presence.previewOffline")}
					</Button>
				</Stack>
			</Stack>
		</Paper>
	);
}
