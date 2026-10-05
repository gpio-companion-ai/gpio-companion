import Button from "@shpaw415/mui-lite/Button";
import { translateError } from "gpio-companion-i18n";
import type { SupportChatState } from "gpio-companion-support";
import { useEffect, useRef, useState } from "react";
import { apiRequest, listDeviceStatus } from "../api";
import { CACHE_KEYS, useCachedQuery } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useLocale, useT } from "../locale";

const EMPTY: SupportChatState = { status: "idle", messages: [] };

export default function SupportChat() {
	const t = useT();
	const { locale } = useLocale();
	const { uuid } = useBoardSelection();
	const boardsQuery = useCachedQuery(CACHE_KEYS.userBoards, listDeviceStatus);
	const board = boardsQuery.data?.devices.find(
		(item) => item.device.uuid === uuid,
	);
	const [state, setState] = useState<SupportChatState>(EMPTY);
	const [text, setText] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const requestGen = useRef(0);

	useEffect(() => {
		let cancelled = false;
		void apiRequest<SupportChatState>("GET", "/api/mobile/support-chat")
			.then((next) => {
				if (!cancelled && next) {
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
		try {
			const next = await apiRequest<SupportChatState>(
				"POST",
				"/api/mobile/support-chat",
				{
					text: body,
					surface: "desktop",
					locale,
					boardUuid: uuid,
					boardModel: board?.status?.model ?? "",
					restart,
				},
			);
			if (requestGen.current !== gen) {
				return;
			}
			if (next) {
				setState(next);
			}
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

	async function cancelReport() {
		const gen = ++requestGen.current;
		setBusy(true);
		setError("");
		try {
			const next = await apiRequest<SupportChatState>(
				"POST",
				"/api/mobile/support-chat",
				{ cancel: true },
			);
			if (requestGen.current !== gen) {
				return;
			}
			setState(next ?? EMPTY);
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
