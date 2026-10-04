import { BOARD_PRESENCE_SOUND_KEY } from "./board-presence.ts";

type MediaAudioLike = {
	preload: string;
	volume: number;
	muted: boolean;
	currentTime: number;
	play: () => Promise<void>;
	pause: () => void;
	load: () => void;
	removeAttribute: (name: string) => void;
};

type PresenceScope = typeof globalThis & {
	window?:
		| {
				addEventListener: (
					type: string,
					listener: () => void,
					options?: { once?: boolean },
				) => void;
				removeEventListener: (type: string, listener: () => void) => void;
		  }
		| undefined;
	Audio?: new (src?: string) => MediaAudioLike;
	localStorage?: {
		getItem: (key: string) => string | null;
	} | null;
};

// Browser and Tauri both need a user gesture before audio may play.
export function createPresenceAudio(onlineUrl: string, offlineUrl: string) {
	const scope = globalThis as PresenceScope;
	const AudioCtor = scope.Audio;
	const win = scope.window;
	if (!AudioCtor || !win) {
		throw new Error("presence audio requires a browser environment");
	}
	const sounds = [new AudioCtor(offlineUrl), new AudioCtor(onlineUrl)];
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
	win.addEventListener("pointerdown", unlock, { once: true });
	win.addEventListener("keydown", unlock, { once: true });
	return {
		play(online: boolean, preview = false) {
			if (disposed) return;
			try {
				if (
					!preview &&
					scope.localStorage?.getItem(BOARD_PRESENCE_SOUND_KEY) === "0"
				)
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
			win.removeEventListener("pointerdown", unlock);
			win.removeEventListener("keydown", unlock);
			for (const sound of sounds) {
				sound.pause();
				sound.removeAttribute("src");
				sound.load();
			}
		},
	};
}
