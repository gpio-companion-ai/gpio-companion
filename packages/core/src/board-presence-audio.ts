import { BOARD_PRESENCE_SOUND_KEY } from "./board-presence.ts";

// Browser and Tauri both need a user gesture before audio may play.
export function createPresenceAudio(onlineUrl: string, offlineUrl: string) {
	const sounds = [new Audio(offlineUrl), new Audio(onlineUrl)];
	let disposed = false;
	for (const sound of sounds) {
		sound.preload = "auto";
		sound.volume = 0.35;
	}
	function unlock() {
		for (const sound of sounds) {
			sound.muted = true;
			void sound
				.play()
				.then(() => {
					sound.pause();
					sound.currentTime = 0;
					sound.muted = false;
				})
				.catch(() => {
					sound.muted = false;
				});
		}
	}
	window.addEventListener("pointerdown", unlock, { once: true });
	window.addEventListener("keydown", unlock, { once: true });
	return {
		play(online: boolean, preview = false) {
			if (disposed) return;
			try {
				if (!preview && localStorage.getItem(BOARD_PRESENCE_SOUND_KEY) === "0")
					return;
			} catch {
				/* Storage may be unavailable. */
			}
			for (const sound of sounds) sound.pause();
			const sound = sounds[online ? 1 : 0];
			if (!sound) return;
			sound.currentTime = 0;
			void sound.play().catch(() => undefined);
		},
		dispose() {
			disposed = true;
			window.removeEventListener("pointerdown", unlock);
			window.removeEventListener("keydown", unlock);
			for (const sound of sounds) {
				sound.pause();
				sound.removeAttribute("src");
				sound.load();
			}
		},
	};
}
