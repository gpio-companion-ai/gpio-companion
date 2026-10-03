import { navigate } from "@next/client";
import { isAppName } from "gpio-companion";
import { useEffect, useState } from "react";
import AppFrame from "../../components/AppFrame.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import { openLoginDialog } from "../../lib/auth/refresh.ts";

function readAppParam(): { app: string; title: string } {
	try {
		const params = new URLSearchParams(window.location.search);
		const app = params.get("app")?.trim() ?? "";
		const title = params.get("title")?.trim() ?? "";
		return { app, title: title || app };
	} catch {
		return { app: "", title: "" };
	}
}

export default function BoardAppPage() {
	const session = useAuthSession();
	const t = useT();
	const { uuid } = useBoardSelection();
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [param, setParam] = useState(readAppParam);

	useEffect(() => {
		setParam(readAppParam());
	}, []);

	const valid = isAppName(param.app);

	return (
		<div className="oc-shell oc-app-page">
			{!loggedIn ? (
				<div className="oc-card">
					<div className="oc-empty">
						<p>{t("code.signIn")}</p>
						<button
							type="button"
							className="oc-neutral"
							onClick={openLoginDialog}
						>
							{t("auth.signIn")}
						</button>
					</div>
				</div>
			) : !valid || !uuid ? (
				<div className="oc-card">
					<div className="oc-empty">
						<p>{t("code.appMissing")}</p>
						<button
							type="button"
							className="oc-neutral"
							onClick={() => navigate("/devices")}
						>
							{t("code.pairBoard")}
						</button>
					</div>
				</div>
			) : (
				<AppFrame uuid={uuid} appId={param.app} title={param.title} />
			)}
		</div>
	);
}
