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
	const { uuid } = useBoardSelection();
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [repos, setRepos] = useState<Array<{ owner: string; name: string }>>(
		[],
	);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!session.data?.id) {
			setDevices([]);
			setRepos([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		void Promise.all([run(getPairing()), loadCodeRepos().catch(() => null)])
			.then(([pairing, projects]) => {
				setDevices(pairing?.devices ?? []);
				setRepos(
					(projects ?? []).map((repo) => ({
						owner: repo.owner,
						name: repo.name,
					})),
				);
			})
			.finally(() => setLoading(false));
	}, [session.data?.id, run]);

	const selected = uuid || devices[0]?.uuid || "";

	return (
		<div className="oc-shell">
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
			) : (
				<OpenCodeSession uuid={selected} repos={repos} />
			)}
		</div>
	);
}
