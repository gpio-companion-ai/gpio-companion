import { useEffect, useRef, useState } from "react";
import { type AppLiveGrant, mintAppFrame } from "../api.ts";
import { useT } from "../locale.tsx";

type Props = {
	uuid: string;
	appId: string;
	title: string;
	onClose?: () => void;
};

const RENEW_CHECK_MS = 30_000;
const RENEW_AHEAD_MS = 60_000;

export default function AppFrame({ uuid, appId, title, onClose }: Props) {
	const t = useT();
	const [grant, setGrant] = useState<AppLiveGrant | null>(null);
	const [error, setError] = useState("");
	const [reloadKey, setReloadKey] = useState(0);
	const grantRef = useRef<AppLiveGrant | null>(null);
	grantRef.current = grant;

	useEffect(() => {
		let cancelled = false;
		async function mint(reload: boolean) {
			try {
				const next = await mintAppFrame(uuid, appId);
				if (cancelled) {
					return;
				}
				setGrant(next);
				setError("");
				if (reload) {
					setReloadKey((key) => key + 1);
				}
			} catch (caught) {
				if (!cancelled) {
					setError(
						caught instanceof Error ? caught.message : t("code.appError"),
					);
				}
			}
		}
		void mint(false);
		const timer = window.setInterval(() => {
			const current = grantRef.current;
			if (!current || Date.now() >= current.expiresAt - RENEW_AHEAD_MS) {
				void mint(true);
			}
		}, RENEW_CHECK_MS);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, [uuid, appId, t]);

	function reload() {
		const current = grantRef.current;
		if (current && Date.now() < current.expiresAt - RENEW_AHEAD_MS) {
			setReloadKey((key) => key + 1);
			return;
		}
		void (async () => {
			try {
				const next = await mintAppFrame(uuid, appId);
				setGrant(next);
				setError("");
				setReloadKey((key) => key + 1);
			} catch (caught) {
				setError(caught instanceof Error ? caught.message : t("code.appError"));
			}
		})();
	}

	return (
		<div className="oc-app-frame">
			<div className="oc-app-bar">
				<strong className="oc-app-title" title={appId}>
					{title}
				</strong>
				<span className="oc-app-actions">
					<button
						type="button"
						className="oc-mini"
						disabled={Boolean(error) || !grant}
						onClick={reload}
					>
						{t("code.appReload")}
					</button>
					{onClose ? (
						<button type="button" className="oc-mini" onClick={onClose}>
							{t("code.appClose")}
						</button>
					) : null}
				</span>
			</div>
			<div className="oc-app-body">
				{error ? (
					<p className="oc-editor-note oc-error-note">{error}</p>
				) : grant ? (
					<iframe
						key={`${appId}-${grant.token.slice(0, 8)}-${reloadKey}`}
						src={grant.url}
						sandbox="allow-scripts allow-forms allow-popups"
						referrerPolicy="no-referrer"
						title={title}
					/>
				) : (
					<p className="oc-editor-note">{t("code.appLoading")}</p>
				)}
			</div>
		</div>
	);
}
