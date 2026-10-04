export const JOURNAL_WINDOWS = [
	{ id: "24h", ms: 24 * 60 * 60 * 1000 },
	{ id: "12h", ms: 12 * 60 * 60 * 1000 },
	{ id: "6h", ms: 6 * 60 * 60 * 1000 },
	{ id: "1h", ms: 60 * 60 * 1000 },
	{ id: "0h30", ms: 30 * 60 * 1000 },
	{ id: "0h15", ms: 15 * 60 * 1000 },
] as const;

export type JournalWindowId = (typeof JOURNAL_WINDOWS)[number]["id"];

export function journalWindowMs(id: JournalWindowId): number {
	return (
		JOURNAL_WINDOWS.find((item) => item.id === id)?.ms ?? 24 * 60 * 60 * 1000
	);
}

export function parseJournalTimestamp(line: string): number | null {
	const match =
		/^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?)/.exec(
			line.trim(),
		);
	if (!match?.[1]) {
		return null;
	}
	const raw = match[1].replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
	const ms = Date.parse(raw);
	return Number.isFinite(ms) ? ms : null;
}

export function filterJournalByAge(
	text: string,
	windowMs: number,
	now = Date.now(),
): string {
	const cutoff = now - windowMs;
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const kept: string[] = [];
	let previousKept = false;
	for (const line of lines) {
		const ts = parseJournalTimestamp(line);
		if (ts === null) {
			if (previousKept || !line.trim()) {
				kept.push(line);
			}
			continue;
		}
		if (ts >= cutoff) {
			kept.push(line);
			previousKept = true;
		} else {
			previousKept = false;
		}
	}
	return kept.join("\n").trim();
}
