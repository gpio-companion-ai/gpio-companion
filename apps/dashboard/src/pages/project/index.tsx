import { GET as getDevice } from "@api/device";
import { GET as getPairing } from "@api/pair";
import { GET as getProfile } from "@api/profile";
import JlcpcbCard from "@components/JlcpcbCard";
import ProjectBrowser from "@components/ProjectBrowser";
import Alert from "@shpaw415/mui-lite/Alert";
import Box from "@shpaw415/mui-lite/Box";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Stepper, { Step, StepLabel } from "@shpaw415/mui-lite/Stepper";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useRef, useState } from "react";
import type { DeviceStatus } from "../../components/DeviceBoardCard.tsx";
import { LinesSkeleton } from "../../components/skeletons.tsx";
import { useActionError } from "../../hooks/useActionError.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import useMobile from "../../hooks/useMobile.ts";
import { useWorkbench } from "../../hooks/useWorkbench.tsx";
import type { StoredPairing } from "../../lib/pairing-store.ts";

function needsWifi(status: DeviceStatus | null | undefined): boolean {
	const type = status?.network?.type;
	return type !== "ethernet" && type !== "wifi";
}

export default function ProjectPage() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const mobile = useMobile();
	const {
		livePins,
		arduinoLivePins,
		verifyResults,
		setProject,
		refreshBoards,
	} = useWorkbench();
	const steps = [
		t("project.stepSignIn"),
		t("project.stepExperience"),
		t("project.stepPair"),
		t("project.stepGithub"),
		t("project.stepReady"),
	];
	const nextFor: Record<
		number,
		{ href: string; label: string; hint: string } | undefined
	> = {
		0: {
			href: "/profile",
			label: t("project.stepSignIn"),
			hint: t("project.hintSignIn"),
		},
		1: {
			href: "/profile#experience",
			label: t("project.stepExperience"),
			hint: t("project.hintExperience"),
		},
		2: {
			href: "/devices",
			label: t("project.pairABoard"),
			hint: t("project.hintPair"),
		},
		3: {
			href: "/profile/github",
			label: t("project.connectGithub"),
			hint: t("project.hintGithub"),
		},
		4: undefined,
	};
	const { uuid: selectedUuid, setUuid: selectBoard } = useBoardSelection();
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [paired, setPaired] = useState(false);
	const [devices, setDevices] = useState<StoredPairing[]>([]);
	const [statuses, setStatuses] = useState<Record<string, DeviceStatus | null>>(
		{},
	);
	const [githubReady, setGithubReady] = useState(false);
	const [profileSet, setProfileSet] = useState(true);
	const [pairingLoading, setPairingLoading] = useState(true);
	const selectedUuidRef = useRef(selectedUuid);
	selectedUuidRef.current = selectedUuid;

	// run() unwraps the ActionResult, so profile is UserProfile | null:
	// null means not saved yet (or the fetch failed and self-heal will retry).
	const refreshProfile = useCallback(
		async (signal?: { cancelled: boolean }) => {
			const userId = session.data?.id;
			if (!userId) {
				setProfileSet(true);
				return;
			}
			const profile = await run(getProfile());
			if (signal?.cancelled) {
				return;
			}
			setProfileSet(Boolean(profile));
		},
		[run, session.data?.id],
	);

	useEffect(() => {
		const signal = { cancelled: false };
		void refreshProfile(signal);
		return () => {
			signal.cancelled = true;
		};
	}, [refreshProfile]);

	// Self-heal like the GitHub step: a transient auth race on load must not
	// strand the "Tell us about you" step until a manual reload.
	const refreshProfileRef = useRef(refreshProfile);
	refreshProfileRef.current = refreshProfile;

	useEffect(() => {
		function onVisible() {
			if (document.visibilityState === "hidden") {
				return;
			}
			void refreshProfileRef.current();
		}
		document.addEventListener("visibilitychange", onVisible);
		window.addEventListener("focus", onVisible);
		return () => {
			document.removeEventListener("visibilitychange", onVisible);
			window.removeEventListener("focus", onVisible);
		};
	}, []);

	useEffect(() => {
		const userId = session.data?.id;
		if (!userId) {
			setPaired(false);
			setDevices([]);
			setStatuses({});
			setGithubReady(false);
			setPairingLoading(false);
			return;
		}
		setPairingLoading(true);
		void run(getPairing())
			.then(async (result) => {
				const next = result?.devices ?? [];
				setDevices(next);
				setPaired(next.length > 0);
				if (!selectedUuidRef.current && next[0]) {
					selectBoard(next[0].uuid);
				}
				if (next.length === 0) {
					setStatuses({});
					return;
				}
				const device = await run(getDevice());
				if (!device?.paired) {
					setStatuses({});
					return;
				}
				const nextStatuses: Record<string, DeviceStatus | null> = {};
				for (const item of device.devices) {
					nextStatuses[item.device.uuid] = item.status as DeviceStatus | null;
				}
				setStatuses(nextStatuses);
			})
			.finally(() => {
				setPairingLoading(false);
				refreshBoards();
			});
	}, [session.data?.id, run, selectBoard, refreshBoards]);

	const step = !loggedIn
		? 0
		: !profileSet
			? 1
			: !paired
				? 2
				: !githubReady
					? 3
					: 4;
	const next = nextFor[step] ?? undefined;
	const activeUuid = selectedUuid || devices[0]?.uuid || "";
	const wifiHint = paired && needsWifi(statuses[activeUuid]);

	return (
		<Stack spacing={1.5} className="project-workbench">
			{paired ? (
				<Stack direction="row" className="justify-end">
					<Button
						href={paired ? "/devices/code" : "/devices"}
						variant="outlined"
						size="small"
						className={mobile ? "w-full" : undefined}
					>
						{t("project.openCode")}
					</Button>
				</Stack>
			) : null}
			{step < 4 || pairingLoading ? (
				<Paper className="workbench-control-rail p-3" elevation={0}>
					<Stack spacing={1.5}>
						{pairingLoading ? (
							<LinesSkeleton lines={2} />
						) : (
							<>
								<Stepper
									activeStep={step}
									alternativeLabel={!mobile}
									orientation={mobile ? "vertical" : "horizontal"}
								>
									{steps.map((label, index) => (
										<Step key={label} completed={step > index}>
											<StepLabel>{label}</StepLabel>
										</Step>
									))}
								</Stepper>
								{next ? (
									<Box className="flex flex-wrap items-center justify-between gap-4">
										<Typography color="secondary">{next.hint}</Typography>
										<Button href={next.href} variant="contained">
											{next.label}
										</Button>
									</Box>
								) : null}
							</>
						)}
					</Stack>
				</Paper>
			) : null}

			{wifiHint ? (
				<Alert severity="info">
					<Stack
						direction={mobile ? "column" : "row"}
						spacing={1}
						className="min-[900px]:items-center min-[900px]:justify-between"
					>
						<Typography color="secondary">{t("project.wifiHint")}</Typography>
						<Button href="/devices/wifi" variant="outlined" size="small">
							{t("project.setWifi")}
						</Button>
					</Stack>
				</Alert>
			) : null}

			{loggedIn ? <JlcpcbCard /> : null}
			<div>
				<ProjectBrowser
					onConfigured={setGithubReady}
					onProject={setProject}
					uuid={activeUuid}
					paired={paired}
					livePins={livePins}
					arduinoLivePins={arduinoLivePins}
					verifyResults={verifyResults}
					boardModel={statuses[activeUuid]?.model}
				/>
			</div>
		</Stack>
	);
}
