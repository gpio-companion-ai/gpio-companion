import { fromManifest } from "agents/skills";

export const lookupSkill = fromManifest({
	id: "gpio-companion-lookup",
	fingerprint: "2026-10-05",
	skills: [
		{
			name: "gpio-companion-lookup",
			description:
				"Read gpio-companion project facts from OpenViking. Use when a bug report needs how a feature works, a route, or a locked product rule.",
			body: [
				"Project facts live in OpenViking at viking://resources/gpio-companion.",
				"Call ov_find with a short question, ov_grep with a symbol or error string, then ov_read on a returned URI.",
				"Stay under that URI. Do not invent files, routes, or behavior the tools did not return.",
				"If a tool says project lookup is unavailable, tell the user you cannot check the project and continue the interview.",
				"Do not write, remember, or delete anything.",
			].join("\n"),
		},
	],
});
