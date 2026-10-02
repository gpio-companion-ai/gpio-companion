import { GET as listDebugDevices, POST as signDebugConnect } from "@api/debug";
import { GET as loadDeviceLogs } from "@api/debug/logs";
import { POST as startDeviceUpdate } from "@api/update";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import { useEffect, useMemo, useState } from "react";
import DeviceDebugPanel from "../../components/DeviceDebugPanel.tsx";
import ExpertGate from "../../components/ExpertGate.tsx";
import { SelectSkeleton } from "../../components/skeletons.tsx";
import { useActionError } from "../../hooks/useActionError.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useT } from "../../hooks/useLocale.tsx";
import { openLoginDialog } from "../../lib/auth/refresh.ts";
import { isAdmin } from "../../lib/auth/role.ts";
import type { DebugBoard } from "../../lib/debug-live.ts";

export default function DeviceDebugPage() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const admin = isAdmin(session.data?.role);
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [devices, setDevices] = useState<DebugBoard[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!session.data?.id) {
			setDevices([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		void run(listDebugDevices())
			.then((result) => {
				setDevices(result?.devices ?? []);
			})
			.finally(() => {
				setLoading(false);
			});
	}, [session.data?.id, run]);

	const options = useMemo(
		() =>
			devices.map((device) => {
				const bits = [
					device.label,
					device.live ? "live" : null,
					device.paired ? null : "unpaired",
					admin ? device.email || device.login : null,
				].filter(Boolean);
				return {
					uuid: device.uuid,
					deviceUrl: device.deviceUrl,
					label: bits.join(" · ") || device.uuid,
					maintenance: device.maintenance,
				};
			}),
		[admin, devices],
	);

	return (
		<ExpertGate>
			<Stack spacing={1.5}>
				{!loggedIn ? (
					<Alert severity="info">
						<Button onClick={openLoginDialog} variant="text">
							{t("auth.signIn")}
						</Button>{" "}
						{t("auth.toDebug")}
					</Alert>
				) : null}

				{loggedIn && loading ? <SelectSkeleton /> : null}

				{loggedIn && !loading && devices.length === 0 ? (
					<Alert severity="info">
						{admin ? t("debug.noLiveAdmin") : t("debug.noLiveUser")}
					</Alert>
				) : null}

				{loggedIn && devices.length > 0 ? (
					<DeviceDebugPanel
						devices={options}
						signConnect={signDebugConnect}
						loadLogs={loadDeviceLogs}
						startUpdate={startDeviceUpdate}
					/>
				) : null}
			</Stack>
		</ExpertGate>
	);
}
