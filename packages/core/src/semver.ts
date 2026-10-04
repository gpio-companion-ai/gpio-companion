export type ParsedVersion = {
	major: number;
	minor: number;
	patch: number;
	prerelease: string[];
};

const VERSION_PATTERN =
	/^v?(\d+)(?:\.(\d+))?(?:\.(\d+))?(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?(?:\+[0-9A-Za-z.-]+)?$/;

export function parseVersion(value: string): ParsedVersion | null {
	const match = VERSION_PATTERN.exec(value.trim());
	if (!match) {
		return null;
	}
	return {
		major: Number(match[1] ?? 0),
		minor: Number(match[2] ?? 0),
		patch: Number(match[3] ?? 0),
		prerelease: match[4] ? match[4].split(".") : [],
	};
}

function comparePrerelease(a: string[], b: string[]): number {
	if (a.length === 0 && b.length === 0) {
		return 0;
	}
	if (a.length === 0) {
		return 1;
	}
	if (b.length === 0) {
		return -1;
	}
	const length = Math.max(a.length, b.length);
	for (let i = 0; i < length; i++) {
		const left = a[i];
		const right = b[i];
		if (left === undefined) {
			return -1;
		}
		if (right === undefined) {
			return 1;
		}
		const leftNumber = /^\d+$/.test(left) ? Number(left) : null;
		const rightNumber = /^\d+$/.test(right) ? Number(right) : null;
		if (leftNumber !== null && rightNumber !== null) {
			if (leftNumber !== rightNumber) {
				return leftNumber < rightNumber ? -1 : 1;
			}
		} else if (leftNumber !== null) {
			return -1;
		} else if (rightNumber !== null) {
			return 1;
		} else if (left !== right) {
			return left < right ? -1 : 1;
		}
	}
	return 0;
}

export function compareVersions(a: string, b: string): number {
	const left = parseVersion(a);
	const right = parseVersion(b);
	if (!left || !right) {
		return 0;
	}
	if (left.major !== right.major) {
		return left.major < right.major ? -1 : 1;
	}
	if (left.minor !== right.minor) {
		return left.minor < right.minor ? -1 : 1;
	}
	if (left.patch !== right.patch) {
		return left.patch < right.patch ? -1 : 1;
	}
	return comparePrerelease(left.prerelease, right.prerelease);
}

export function isNewerVersion(candidate: string, current: string): boolean {
	return compareVersions(candidate, current) > 0;
}
