import { GET as getPairing } from "@api/pair";
import { useEffect, useState } from "react";
import OpenCodeSession, {
	loadCodeRepos,
} from "../../components/OpenCodeSession.tsx";
import { useActionError } from "../../hooks/useActionError.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import type { StoredPairing } from "../../lib/pairing-store.ts";

export default function CodePage() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const { uuid, setUuid } = useBoardSelection();
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [repos, setRepos] = useState<Array<{ owner: string; name: string }>>(
		[],
	);
	const [loading, setLoading] = useState(true);
	const [reposError, setReposError] = useState("");

	useEffect(() => {
		if (!session.data?.id) {
			setDevices([]);
			setRepos([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		setReposError("");
		void Promise.all([run(getPairing()), loadCodeRepos().catch(() => null)])
			.then(([pairing, projects]) => {
				setDevices(pairing?.devices ?? []);
				if (!projects) {
					setRepos([]);
					setReposError(t("code.reposError"));
					return;
				}
				setRepos(
					(projects ?? []).map((repo) => ({
						owner: repo.owner,
						name: repo.name,
					})),
				);
			})
			.finally(() => setLoading(false));
	}, [session.data?.id, run, t]);

	const selected = uuid || devices[0]?.uuid || "";

	return (
		<div className="oc-shell">
			{loggedIn && devices.length > 1 ? (
				<div className="oc-boardbar">
					<label className="oc-chip">
						{t("code.board")}
						<select
							value={selected}
							aria-label={t("code.board")}
							onChange={(event) => setUuid(event.target.value)}
						>
							{devices.map((item) => (
								<option key={item.uuid} value={item.uuid}>
									{item.label || item.uuid}
								</option>
							))}
						</select>
					</label>
				</div>
			) : null}
			{!loggedIn ? (
				<div className="oc-card">
					<div className="oc-empty">
						<p>{t("code.signIn")}</p>
						<a className="oc-neutral" href="/login">
							{t("auth.signIn")}
						</a>
					</div>
				</div>
			) : loading ? (
				<div className="oc-card" aria-busy="true">
					<div className="oc-skel" />
					<div className="oc-skel" />
					<div className="oc-skel" />
				</div>
			) : devices.length === 0 || !selected ? (
				<div className="oc-card">
					<div className="oc-empty">
						<p>{t("code.pickBoard")}</p>
						<a className="oc-neutral" href="/devices">
							{t("code.pairBoard")}
						</a>
					</div>
				</div>
			) : reposError && repos.length === 0 ? (
				<div className="oc-card">
					<div className="oc-empty">
						<p className="oc-muted">{t("code.reposError")}</p>
						<button
							type="button"
							className="oc-neutral"
							onClick={() => window.location.reload()}
						>
							{t("code.retry")}
						</button>
					</div>
				</div>
			) : (
				<OpenCodeSession uuid={selected} repos={repos} />
			)}
		</div>
	);
}
