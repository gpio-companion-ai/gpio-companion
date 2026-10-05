import Button from "@shpaw415/mui-lite/Button";
import type { SupportChatMessage, SupportChatState } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useRef, useState } from "react";
import { useBoardSelection } from "../hooks/useBoardSelection.tsx";
import { useLocale, useT } from "../hooks/useLocale.tsx";
import { useWorkbench } from "../hooks/useWorkbench.tsx";
import { Blocks } from "./OcMarkdown.tsx";

const EMPTY: SupportChatState = { status: "idle", messages: [] };

type ToolNote = {
	id: string;
	name: string;
	text: string;
	status?: "running" | "done" | "error";
};
type TranscriptRow =
	| { kind: "user"; id: string; text: string }
	| { kind: "agent"; id: string; text: string }
	| { kind: "tools"; id: string; tools: ToolNote[] };

function oneLine(text: string): string {
	const line = text.split("\n").find((part) => part.trim()) ?? "";
	return line.length > 96 ? `${line.slice(0, 93)}…` : line;
}

function toolStatus(text: string): "done" | "error" {
	const lower = text.toLowerCase();
	if (lower.startsWith("project lookup") || lower.includes("unavailable")) {
		return "error";
	}
	return "done";
}

function transcriptRows(messages: SupportChatMessage[]): TranscriptRow[] {
	const rows: TranscriptRow[] = [];
	for (const message of messages) {
		if (message.role === "tool") {
			const note = {
				id: message.id,
				name: message.tool || "tool",
				text: message.text,
			};
			const last = rows.at(-1);
			if (last?.kind === "tools") {
				last.tools.push(note);
			} else {
				rows.push({ kind: "tools", id: message.id, tools: [note] });
			}
			continue;
		}
		rows.push({
			kind: message.role === "user" ? "user" : "agent",
			id: message.id,
			text: message.text,
		});
	}
	return rows;
}

function noteStatus(tool: ToolNote): "running" | "done" | "error" {
	return tool.status ?? toolStatus(tool.text);
}

function SupportTools({ tools }: { tools: ToolNote[] }) {
	const t = useT();
	const running = tools.some((tool) => noteStatus(tool) === "running");
	const touched = useRef(false);
	const [open, setOpen] = useState(running);
	const [info, setInfo] = useState("");
	useEffect(() => {
		if (!touched.current) {
			setOpen(running);
		}
	}, [running]);
	const names = [...new Set(tools.map((tool) => tool.name))].join(", ");
	const label =
		tools.length === 1 ? names : t("code.toolStack", { n: tools.length, names });
	const status = running
		? "running"
		: tools.some((tool) => noteStatus(tool) === "error")
			? "error"
			: "done";
	return (
		<div className={`oc-tools is-${status}${open ? " is-open" : ""}`}>
			<button
				type="button"
				className="oc-tools-toggle"
				aria-expanded={open}
				onClick={() => {
					touched.current = true;
					setOpen((value) => !value);
				}}
			>
				<i className="oc-chevron" aria-hidden="true" />
				<strong className="oc-tools-label">{label}</strong>
				<i className={`oc-tool-state is-${status}`} aria-hidden="true" />
			</button>
			{open ? (
				<div className="oc-tools-rows">
					{tools.map((tool) => {
						const rowStatus = noteStatus(tool);
						const summary = oneLine(tool.text);
						return (
							<div key={tool.id} className={`oc-tool-row is-${rowStatus}`}>
								<button
									type="button"
									className="oc-tool-head"
									aria-expanded={info === tool.id}
									onClick={() =>
										setInfo((current) => (current === tool.id ? "" : tool.id))
									}
								>
									<i className="oc-chevron" aria-hidden="true" />
									<strong className="oc-tool-name">{tool.name}</strong>
									{summary ? (
										<span className="oc-tool-summary">{summary}</span>
									) : null}
									<i
										className={`oc-tool-state is-${rowStatus}`}
										aria-hidden="true"
									/>
								</button>
								{info === tool.id && tool.text ? (
									<pre className="oc-code oc-tool-info">{tool.text}</pre>
								) : null}
							</div>
						);
					})}
				</div>
			) : null}
		</div>
	);
}

function AgentTurn({ text }: { text: string }) {
	return (
		<article className="oc-turn is-assistant">
			<Blocks text={text} />
		</article>
	);
}

async function supportRequest(path: string, init?: RequestInit) {
	const response = await fetch(path, {
		...init,
		headers: {
			accept: "application/json",
			...(init?.body ? { "content-type": "application/json" } : {}),
			...init?.headers,
		},
	});
	const payload = (await response.json().catch(() => null)) as {
		ok?: boolean;
		error?: string;
		data?: SupportChatState;
	} | null;
	if (!payload?.ok || !payload.data) {
		throw new Error(payload?.error || "support agent is not bound");
	}
	return payload.data;
}

export default function SupportChat() {
	const t = useT();
	const { locale } = useLocale();
	const { uuid } = useBoardSelection();
	const { boards } = useWorkbench();
	const board = boards.find((item) => item.uuid === uuid);
	const [state, setState] = useState<SupportChatState>(EMPTY);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const requestGen = useRef(0);

	useEffect(() => {
		let cancelled = false;
		void supportRequest("/api/support-chat")
			.then((next) => {
				if (!cancelled) {
					setState(next);
				}
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(
						caught instanceof Error
							? caught.message
							: "support agent is not bound",
					);
				}
			});
		return () => {
			cancelled = true;
		};
	}, []);

	async function send(restart = false) {
		const body = restart ? t("profile.bugNew") : text.trim();
		if (!body && !restart) {
			return;
		}
		const gen = ++requestGen.current;
		setBusy(true);
		setError("");
		const poll = window.setInterval(() => {
			void supportRequest("/api/support-chat")
				.then((next) => {
					if (requestGen.current === gen) {
						setState(next);
					}
				})
				.catch(() => undefined);
		}, 400);
		try {
			const next = await supportRequest("/api/support-chat", {
				method: "POST",
				body: JSON.stringify({
					text: body,
					surface: "web",
					locale,
					boardUuid: uuid,
					boardModel: board?.model ?? "",
					restart,
				}),
			});
			if (requestGen.current !== gen) {
				return;
			}
			setState(next);
			setText("");
		} catch (caught) {
			if (requestGen.current !== gen) {
				return;
			}
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			window.clearInterval(poll);
			if (requestGen.current === gen) {
				setBusy(false);
			}
		}
	}

	async function cancelReport() {
		const gen = ++requestGen.current;
		setBusy(true);
		setError("");
		try {
			const next = await supportRequest("/api/support-chat", {
				method: "POST",
				body: JSON.stringify({ cancel: true }),
			});
			if (requestGen.current !== gen) {
				return;
			}
			setState(next);
			setText("");
		} catch (caught) {
			if (requestGen.current !== gen) {
				return;
			}
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			if (requestGen.current === gen) {
				setBusy(false);
			}
		}
	}

	const completed = state.status === "completed";

	return (
		<section className="support-chat-panel" aria-label={t("profile.bugChatTitle")}>
			<header className="flex items-center justify-between gap-2 px-3 py-2">
				<strong>{t("profile.bugChatTitle")}</strong>
				{!completed && (state.status === "chatting" || busy) ? (
					<Button
						type="button"
						variant="text"
						size="small"
						onClick={() => void cancelReport()}
					>
						{t("profile.bugCancel")}
					</Button>
				) : null}
			</header>
					<div className="support-chat-log">
						<AgentTurn text={t("profile.bugGreeting")} />
						{transcriptRows(state.messages).map((row) => {
							if (row.kind === "user") {
								return (
									<article key={row.id} className="oc-turn is-user">
										<p className="oc-user">{row.text}</p>
									</article>
								);
							}
							if (row.kind === "agent") {
								return <AgentTurn key={row.id} text={row.text} />;
							}
							return <SupportTools key={row.id} tools={row.tools} />;
						})}
						{state.live?.tools.length ? (
							<SupportTools tools={state.live.tools} />
						) : null}
						{state.live?.draft ? <AgentTurn text={state.live.draft} /> : null}
						{busy && !completed && !state.live?.draft ? (
							<div className="oc-tools oc-thinking is-running">
								<div className="oc-tools-toggle">
									<i className="oc-chevron" aria-hidden="true" />
									<strong className="oc-tools-label">{t("code.thinking")}</strong>
									<i className="oc-tool-state is-running" aria-hidden="true" />
								</div>
							</div>
						) : null}
						{completed ? <AgentTurn text={t("profile.bugThanks")} /> : null}
						{error ? <p>{translateError(t, error)}</p> : null}
					</div>
					{completed ? (
						<div className="support-chat-compose">
							<Button
								type="button"
								variant="contained"
								size="small"
								disabled={busy}
								onClick={() => void send(true)}
							>
								{t("profile.bugNew")}
							</Button>
						</div>
					) : (
						<form
							className="support-chat-compose"
							onSubmit={(event) => {
								event.preventDefault();
								void send();
							}}
						>
							<textarea
								value={text}
								placeholder={t("profile.bugPlaceholder")}
								disabled={busy}
								onChange={(event) => setText(event.target.value)}
							/>
							<Button
								type="submit"
								variant="contained"
								size="small"
								disabled={busy || !text.trim()}
							>
								{busy ? t("profile.bugSending") : t("profile.bugSend")}
							</Button>
						</form>
					)}
		</section>
	);
}
