export type CodeSpeechStatus = {
	speaking: boolean;
	paused: boolean;
	preparing: boolean;
	canReplay: boolean;
};

export type CodeSpeechPlayer = {
	finished: Promise<void>;
	pause(): void;
	resume(): void;
	stop(): void;
};

type SpeechClip = { text: string; audio?: Promise<string> };

// Platform-independent playback lifecycle; each app owns its native audio player.
export class CodeSpeechQueue {
	private generation = 0;
	private running: number | null = null;
	private clips: SpeechClip[] = [];
	private history: SpeechClip[] = [];
	private player: CodeSpeechPlayer | null = null;
	private wake: (() => void) | null = null;
	private status: CodeSpeechStatus = {
		speaking: false,
		paused: false,
		preparing: false,
		canReplay: false,
	};

	constructor(
		private readonly io: {
			fetch(text: string): Promise<string>;
			play(audio: string): CodeSpeechPlayer;
			changed(status: CodeSpeechStatus): void;
			failed(error: unknown): void;
		},
	) {}

	private update(patch: Partial<CodeSpeechStatus>) {
		this.status = { ...this.status, ...patch };
		this.io.changed(this.status);
	}

	playback(speaking: boolean, preparing = false) {
		this.update({
			speaking: speaking && !this.status.paused && !preparing,
			preparing,
		});
	}

	enqueue(text: string) {
		if (!text.trim()) return;
		const clip = { text };
		this.history.push(clip);
		this.clips.push(clip);
		this.update({ canReplay: true });
		void this.pump();
	}

	pause() {
		this.player?.pause();
		this.update({ paused: true, speaking: false });
	}

	resume() {
		this.update({ paused: false, speaking: false });
		this.player?.resume();
		this.wake?.();
		this.wake = null;
		void this.pump();
	}

	cancel() {
		this.generation += 1;
		this.clips = [];
		this.player?.stop();
		this.player = null;
		this.wake?.();
		this.wake = null;
		this.update({ speaking: false, paused: false, preparing: false });
	}

	reset() {
		this.cancel();
		this.history = [];
		this.update({ canReplay: false });
	}

	replay() {
		if (!this.history.length) return;
		this.cancel();
		this.clips = [...this.history];
		void this.pump();
	}

	private audio(clip: SpeechClip) {
		if (!clip.audio) {
			clip.audio = this.io.fetch(clip.text).catch((error) => {
				clip.audio = undefined; // A failed request can be retried with Replay.
				throw error;
			});
		}
		return clip.audio;
	}

	private async ready(generation: number) {
		while (this.status.paused && generation === this.generation) {
			await new Promise<void>((resolve) => {
				this.wake = resolve;
			});
		}
		return generation === this.generation;
	}

	private async pump() {
		const generation = this.generation;
		if (this.running === generation || !this.clips.length) return;
		this.running = generation;
		try {
			while (this.clips.length && generation === this.generation) {
				if (!(await this.ready(generation))) return;
				const clip = this.clips[0];
				if (!clip) return;
				try {
					this.update({ preparing: true });
					const audio = await this.audio(clip);
					if (!(await this.ready(generation))) return;
					const player = this.io.play(audio);
					this.player = player;
					// Fetch one clip ahead while playing; reuse its promise for Replay.
					const next = this.clips[1];
					if (next) void this.audio(next).catch(() => {});
					await player.finished;
				} catch (error) {
					if (generation === this.generation) this.io.failed(error);
				}
				if (generation !== this.generation) return;
				this.player = null;
				this.clips.shift();
				this.update({ speaking: false, preparing: false });
			}
		} finally {
			if (this.running === generation) this.running = null;
		}
	}
}
