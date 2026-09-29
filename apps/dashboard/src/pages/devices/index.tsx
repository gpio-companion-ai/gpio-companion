import { GET as getDevice } from "@api/device";
import { GET as loadDeviceInfo } from "@api/device/info";
import { GET as listNotes } from "@api/notifications";
import { GET as getPairing, DELETE as unpairDevice } from "@api/pair";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useState } from "react";
import DeviceBoardCard, {
	type BoardView,
	type DeviceStatus,
} from "../../components/DeviceBoardCard.tsx";
import PairForm from "../../components/PairForm.tsx";
import { BoardCardSkeleton } from "../../components/skeletons.tsx";
import { useActionError } from "../../hooks/useActionError.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useDashboardMode } from "../../hooks/useDashboardMode.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import useMobile from "../../hooks/useMobile.ts";
import { useWorkbench } from "../../hooks/useWorkbench.tsx";

export default function DevicesPage() {
	const session = useAuthSession();
	const { run } = useActionError();
	const { isEasy } = useDashboardMode();
	const t = useT();
	const mobile = useMobile();
	const { refreshBoards } = useWorkbench();
	const { uuid: selectedUuid, setUuid: selectBoard } = useBoardSelection();
	const loggedIn = Boolean(session.data?.id || session.data?.email);
	const [boards, setBoards] = useState<BoardView[]>([]);
	const [loading, setLoading] = useState(true);
	const [dialogOpen, setDialogOpen] = useState(false);
	const [pendingCount, setPendingCount] = useState(0);
	const [unpairing, setUnpairing] = useState("");
	const [confirmUuid, setConfirmUuid] = useState("");

	const refresh = useCallback(async () => {
		if (!session.data?.id) {
			setBoards([]);
			setPendingCount(0);
			setLoading(false);
			return;
		}
		setLoading(true);
		const result = await run(getPairing());
		if (!result?.paired) {
			setBoards([]);
		} else {
			const device = await run(getDevice());
			if (device?.paired) {
				setBoards(
					device.devices.map((item) => ({
						device: item.device,
						status: item.status as DeviceStatus | null,
					})),
				);
			} else {
				setBoards(
					result.devices.map((item) => ({ device: item, status: null })),
				);
			}
		}
		if (isEasy) {
			const notes = await run(listNotes());
			setPendingCount(notes?.items.length ?? 0);
		} else {
			setPendingCount(0);
		}
		setLoading(false);
		refreshBoards();
	}, [session.data?.id, run, isEasy, refreshBoards]);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	useEffect(() => {
		if (boards.length === 0) {
			return;
		}
		if (selectedUuid && boards.some((b) => b.device.uuid === selectedUuid)) {
			return;
		}
		selectBoard(boards[0]?.device.uuid ?? "");
	}, [boards, selectedUuid, selectBoard]);

	const showForm = loggedIn && !loading && boards.length === 0;

	return (
		<Stack spacing={1.5}>
			{loggedIn && boards.length > 0 ? (
				<Stack direction="row" className="justify-end">
					<Button
						type="button"
						variant="contained"
						size="small"
						className={mobile ? "w-full" : undefined}
						onClick={() => setDialogOpen(true)}
					>
						{t("devices.addBoard")}
					</Button>
				</Stack>
			) : null}

			{!loggedIn ? (
				<Alert severity="info">
					<Button href="/login" variant="text">
						{t("auth.signIn")}
					</Button>{" "}
					{t("auth.toManageBoards")}
				</Alert>
			) : null}

			{loggedIn && isEasy && pendingCount > 0 ? (
				<Alert severity="info">
					{t("devices.pendingTransfer")}{" "}
					<Button href="/devices/notifications" variant="text">
						{t("devices.reviewRequests")}
					</Button>
				</Alert>
			) : null}

			{loggedIn && loading ? (
				<>
					<BoardCardSkeleton />
					<BoardCardSkeleton />
				</>
			) : null}

			{showForm ? (
				<PairForm
					onComplete={() => {
						void refresh();
					}}
				/>
			) : null}

			{boards.map((board) => (
				<DeviceBoardCard
					key={board.device.uuid}
					device={board.device}
					status={board.status}
					selected={board.device.uuid === selectedUuid}
					onSelect={selectBoard}
					loadInfo={isEasy ? undefined : loadDeviceInfo}
					unpairing={unpairing === board.device.uuid}
					onLabelSaved={(label) => {
						setBoards((current) =>
							current.map((item) =>
								item.device.uuid === board.device.uuid
									? { ...item, device: { ...item.device, label } }
									: item,
							),
						);
					}}
					onUnpair={(uuid) => {
						setConfirmUuid(uuid);
					}}
				/>
			))}

			<Dialog
				open={dialogOpen}
				onClose={() => setDialogOpen(false)}
				fullWidth
				fullScreen={mobile}
				scroll="paper"
				sx={{ zIndex: 1300 }}
				slotProps={{ paper: { className: "max-w-xl w-full" } }}
			>
				<DialogTitle>{t("devices.addBoard")}</DialogTitle>
				<DialogContent>
					{dialogOpen ? (
						<PairForm
							variant="dialog"
							onComplete={() => {
								void refresh();
							}}
						/>
					) : null}
				</DialogContent>
				<DialogActions>
					<Button
						type="button"
						variant="text"
						onClick={() => setDialogOpen(false)}
					>
						{t("devices.close")}
					</Button>
				</DialogActions>
			</Dialog>
			<Dialog
				open={Boolean(confirmUuid)}
				onClose={() => {
					if (!unpairing) {
						setConfirmUuid("");
					}
				}}
				fullWidth
				fullScreen={mobile}
				scroll="paper"
				sx={{ zIndex: 1300 }}
				slotProps={{ paper: { className: "max-w-xl w-full" } }}
			>
				<DialogTitle>{t("devices.unpairTitle")}</DialogTitle>
				<DialogContent>
					<Stack spacing={1}>
						<Alert severity="warning">{t("devices.unpairConfirm")}</Alert>
						<Typography color="secondary">
							{t("devices.unpairDetail")}
						</Typography>
					</Stack>
				</DialogContent>
				<DialogActions>
					<Button
						type="button"
						variant="text"
						disabled={Boolean(unpairing)}
						onClick={() => setConfirmUuid("")}
					>
						{t("devices.close")}
					</Button>
					<Button
						type="button"
						variant="contained"
						color="error"
						disabled={Boolean(unpairing)}
						onClick={() => {
							const uuid = confirmUuid;
							if (!uuid) {
								return;
							}
							setUnpairing(uuid);
							void run(unpairDevice(uuid)).then((result) => {
								setUnpairing("");
								setConfirmUuid("");
								if (!result) {
									return;
								}
								void refresh();
							});
						}}
					>
						{t("devices.unpair")}
					</Button>
				</DialogActions>
			</Dialog>
		</Stack>
	);
}
