import { GET as getPairing } from "@api/pair";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import { useEffect, useState } from "react";
import DeviceSelect from "../../components/DeviceSelect.tsx";
import OpenCodeSession, {
	loadCodeRepos,
} from "../../components/OpenCodeSession.tsx";
import { SelectSkeleton } from "../../components/skeletons.tsx";
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

	if (!loggedIn) {
		return (
			<Alert severity="info">
				<Button href="/login" variant="text" size="small">
					{t("auth.signIn")}
				</Button>{" "}
				{t("code.signIn")}
			</Alert>
		);
	}
	if (loading) {
		return <SelectSkeleton height={40} />;
	}
	if (devices.length === 0) {
		return (
			<Alert severity="info">
				<Button href="/devices" variant="text" size="small">
					{t("project.pairABoard")}
				</Button>
			</Alert>
		);
	}
	const selected = uuid || devices[0]?.uuid || "";
	return (
		<Stack spacing={1.5}>
			<DeviceSelect
				devices={devices}
				value={selected}
				onChange={setUuid}
				label={t("code.board")}
			/>
			{selected ? (
				<OpenCodeSession uuid={selected} repos={repos} />
			) : (
				<Alert severity="info">{t("code.pickBoard")}</Alert>
			)}
		</Stack>
	);
}
