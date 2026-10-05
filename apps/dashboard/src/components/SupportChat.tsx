import Button from "@shpaw415/mui-lite/Button";
import type { SupportChatState } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useBoardSelection } from "../hooks/useBoardSelection.tsx";
import { useLocale, useT } from "../hooks/useLocale.tsx";
import { useWorkbench } from "../hooks/useWorkbench.tsx";

const EMPTY: SupportChatState = { status: "idle", messages: [] };

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
		setBusy(true);
		setError("");
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
			setState(next);
			setText("");
		} catch (caught) {
			setError(
				caught instanceof Error ? caught.message : "support agent is not bound",
			);
		} finally {
			setBusy(false);
		}
	}

	const completed = state.status === "completed";

	return (
		<section className="support-chat-panel" aria-label={t("profile.bugChatTitle")}>
			<header className="flex items-center justify-between gap-2 px-3 py-2">
				<strong>{t("profile.bugChatTitle")}</strong>
			</header>
					<div className="support-chat-log">
						<p className="support-chat-bubble agent">
							{t("profile.bugGreeting")}
						</p>
						{state.messages.map((message) => (
							<p
								key={message.id}
								className={`support-chat-bubble ${message.role}`}
							>
								{message.tool ? `${message.tool}: ` : ""}
								{message.text}
							</p>
						))}
						{completed ? (
							<p className="support-chat-bubble agent">
								{t("profile.bugThanks")}
							</p>
						) : null}
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
