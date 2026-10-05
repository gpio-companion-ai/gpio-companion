const SECRET_PATTERNS: RegExp[] = [
	/-----BEGIN [A-Z0-9 ]+-----[\s\S]*?-----END [A-Z0-9 ]+-----/g,
	/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi,
	/\b(?:ghp_|gho_|ghu_|ghs_|ghr_|github_pat_)[A-Za-z0-9_]+/g,
	/\bgpioai\.v1\.[A-Za-z0-9._-]+/g,
	/\bAKIA[0-9A-Z]{16}\b/g,
	/\bsk-[A-Za-z0-9_-]{16,}\b/g,
	/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
	/\b[A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)[A-Z0-9_]*\s*=\s*\S+/g,
	/\b(?:password|passwd|psk|api[_-]?key|secret|token|authorization|pairing[_-]?key)\s*[:=]\s*\S+/gi,
	/https?:\/\/[^\s/@]+:[^\s/@]+@/gi,
	/\b[A-Fa-f0-9]{64,}\b/g,
];

export function redactSecrets(value: string): string {
	let next = value;
	for (const pattern of SECRET_PATTERNS) {
		next = next.replace(pattern, (match) => {
			const labeled =
				/^((?:password|passwd|psk|api[_-]?key|secret|token|authorization|pairing[_-]?key)\s*[:=]\s*)/i.exec(
					match,
				);
			if (labeled?.[1]) {
				return `${labeled[1]}[redacted]`;
			}
			const envLabeled = /^([A-Z0-9_]+=)/.exec(match);
			if (
				envLabeled?.[1] &&
				/(?:KEY|TOKEN|SECRET|PASSWORD)/.test(envLabeled[1])
			) {
				return `${envLabeled[1]}[redacted]`;
			}
			if (/^https?:\/\//i.test(match)) {
				return match.replace(/:\/\/[^:]+:[^@]+@/, "://[redacted]@");
			}
			return "[redacted]";
		});
	}
	return next;
}
