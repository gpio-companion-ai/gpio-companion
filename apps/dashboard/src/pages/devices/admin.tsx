import {
	POST as adminTransfer,
	DELETE as adminUnpair,
	GET as listAdminDevices,
	PATCH as patchAdminDevice,
} from "@api/admin/devices";
import { GET as loadDeviceInfo } from "@api/device/info";
import { POST as startDeviceUpdate } from "@api/update";
import { POST as signWifi } from "@api/wifi";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import { TablePagination } from "@shpaw415/mui-lite/Pagination";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Table, {
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { envelopeToPasteText, type NetworkStatus } from "gpio-companion";
import { useCallback, useEffect, useMemo, useState } from "react";
import CopyBlock from "../../components/CopyBlock.tsx";
import DeviceCompanionInfo from "../../components/DeviceCompanionInfo.tsx";
import DeviceLabelField from "../../components/DeviceLabelField.tsx";
import ExpertGate from "../../components/ExpertGate.tsx";
import { TableRowsSkeleton } from "../../components/skeletons.tsx";
import { useActionError } from "../../hooks/useActionError.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import useMobile from "../../hooks/useMobile.ts";
import { unwrapAction } from "../../lib/action.ts";
import { openLoginDialog } from "../../lib/auth/refresh.ts";
import { isAdmin } from "../../lib/auth/role.ts";
import {
	deviceDisplayName,
	type PublicPairing,
} from "../../lib/pairing-store.ts";

type DeviceStatus = {
	hardware?: string;
	model?: string;
	tunnel?: { configured?: boolean };
	secrets?: { githubReady?: boolean };
	network?: NetworkStatus | null;
};

type BoardView = {
	device: PublicPairing;
	status: DeviceStatus | null;
};

export default function AdminDevicesPage() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const mobile = useMobile();
	const admin = isAdmin(session.data?.role);
	const [boards, setBoards] = useState<BoardView[]>([]);
	const [loading, setLoading] = useState(true);
	const { uuid: selected, setUuid: setSelected } = useBoardSelection();
	const [query, setQuery] = useState("");
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10);
	const [ssid, setSsid] = useState("");
	const [psk, setPsk] = useState("");
	const [toUserId, setToUserId] = useState("");
	const [pasteText, setPasteText] = useState("");
	const [busy, setBusy] = useState(false);
	const [updateNote, setUpdateNote] = useState("");

	const applyList = useCallback(
		(
			result: {
				devices?: Array<{ device: PublicPairing; status: unknown }>;
			} | null,
		) => {
			setBoards(
				(result?.devices ?? []).map((item) => ({
					device: item.device,
					status: item.status as DeviceStatus | null,
				})),
			);
		},
		[],
	);

	useEffect(() => {
		if (!session.data?.id || !admin) {
			setBoards([]);
			setLoading(false);
			return;
		}
		setLoading(true);
		void run(listAdminDevices())
			.then(applyList)
			.finally(() => setLoading(false));
	}, [session.data?.id, admin, run, applyList]);

	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) {
			return boards;
		}
		return boards.filter((board) => {
			const haystack = [
				board.device.uuid,
				board.device.label,
				board.device.userId,
				board.device.email,
				board.device.login,
				board.device.deviceUrl,
			]
				.join(" ")
				.toLowerCase();
			return haystack.includes(needle);
		});
	}, [boards, query]);

	const paged = filtered.slice(
		page * rowsPerPage,
		page * rowsPerPage + rowsPerPage,
	);
	const current = boards.find((board) => board.device.uuid === selected);

	async function sendWifi() {
		if (!selected || !ssid || !psk) {
			return;
		}
		setBusy(true);
		try {
			const envelope = unwrapAction(
				await signWifi({ uuid: selected, ssid, psk }),
			);
			setPasteText(envelopeToPasteText(envelope));
			setPsk("");
		} finally {
			setBusy(false);
		}
	}

	return (
		<ExpertGate>
			<Stack spacing={1.5}>
				{!session.data?.id && !session.data?.email ? (
					<Alert severity="info">
						<Button onClick={openLoginDialog} variant="text">
							{t("auth.signIn")}
						</Button>{" "}
						{t("auth.toAdmin")}
					</Alert>
				) : null}

				{session.data?.id && !admin ? (
					<Alert severity="error">{t("admin.only")}</Alert>
				) : null}

				{admin ? (
					<>
						<Paper className="p-3 min-[900px]:p-4" elevation={1}>
							<Stack spacing={2}>
								<TextField
									label={t("admin.filter")}
									value={query}
									onChange={(event) => {
										setQuery(event.target.value);
										setPage(0);
									}}
									className="w-full min-[900px]:max-w-sm"
								/>
								<TableContainer>
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>{t("admin.colLabel")}</TableCell>
												{mobile ? null : (
													<TableCell>{t("admin.colUuid")}</TableCell>
												)}
												<TableCell>{t("admin.colOwner")}</TableCell>
												{mobile ? null : (
													<TableCell>{t("admin.colDeviceUrl")}</TableCell>
												)}
												<TableCell>{t("admin.colStatus")}</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{loading ? (
												<TableRowsSkeleton rows={5} columns={mobile ? 3 : 5} />
											) : (
												paged.map((board) => (
													<TableRow
														key={board.device.uuid}
														hover
														selected={selected === board.device.uuid}
														onClick={() => {
															setSelected(board.device.uuid);
															setPasteText("");
															setUpdateNote("");
														}}
													>
														<TableCell className="break-all">
															{board.device.label || "—"}
														</TableCell>
														{mobile ? null : (
															<TableCell className="break-all">
																{board.device.uuid}
															</TableCell>
														)}
														<TableCell className="break-all">
															{board.device.email ||
																board.device.login ||
																board.device.userId}
														</TableCell>
														{mobile ? null : (
															<TableCell className="break-all">
																{board.device.deviceUrl}
															</TableCell>
														)}
														<TableCell>
															{board.status ? (
																<Stack
																	direction="row"
																	spacing={1}
																	className="flex-wrap"
																>
																	{board.status.model ||
																	board.status.hardware ? (
																		<Chip
																			label={
																				board.status.model ||
																				board.status.hardware
																			}
																			variant="outlined"
																		/>
																	) : null}
																	{board.status.network?.type === "ethernet" ? (
																		<Chip
																			label={t("devices.ethernet")}
																			variant="outlined"
																		/>
																	) : board.status.network?.type === "wifi" ? (
																		<Chip
																			label={
																				board.status.network.ssid.trim()
																					? t("devices.wifiSsid", {
																							ssid: board.status.network.ssid.trim(),
																						})
																					: t("nav.wifi")
																			}
																			variant="outlined"
																		/>
																	) : null}
																</Stack>
															) : (
																<Typography color="secondary" variant="body2">
																	{t("devices.offline")}
																</Typography>
															)}
														</TableCell>
													</TableRow>
												))
											)}
										</TableBody>
									</Table>
								</TableContainer>
								{loading ? null : filtered.length === 0 ? (
									<Typography color="secondary">
										{t("admin.noBoards")}
									</Typography>
								) : (
									<TablePagination
										count={filtered.length}
										page={page}
										rowsPerPage={rowsPerPage}
										onPageChange={(_event, nextPage) => setPage(nextPage)}
										onRowsPerPageChange={(next) => {
											setRowsPerPage(next);
											setPage(0);
										}}
									/>
								)}
							</Stack>
						</Paper>

						{current ? (
							<Paper
								className="w-full max-w-2xl p-4 min-[900px]:p-6"
								elevation={1}
							>
								<Stack spacing={2}>
									<Typography variant="h6">
										{deviceDisplayName(current.device)}
									</Typography>
									<Typography color="secondary" className="break-all">
										{current.device.uuid}
									</Typography>
									<Typography color="secondary" className="break-all">
										{current.device.email ||
											current.device.login ||
											current.device.userId}
									</Typography>
									<DeviceLabelField
										uuid={current.device.uuid}
										label={current.device.label}
										persist={async (input) =>
											unwrapAction(await patchAdminDevice(input))
										}
										onSaved={(label) => {
											setBoards((currentBoards) =>
												currentBoards.map((board) =>
													board.device.uuid === current.device.uuid
														? {
																...board,
																device: { ...board.device, label },
															}
														: board,
												),
											);
										}}
									/>
									<Button
										href="/devices/code"
										variant="contained"
										size="small"
										onClick={() => setSelected(current.device.uuid)}
									>
										{t("project.openCode")}
									</Button>
									<DeviceCompanionInfo
										key={current.device.uuid}
										uuid={current.device.uuid}
										loadInfo={loadDeviceInfo}
									/>
									<TextField
										label={t("wifi.ssid")}
										value={ssid}
										onChange={(event) => setSsid(event.target.value)}
										className="w-full"
									/>
									<TextField
										label={t("wifi.password")}
										type="password"
										autoComplete="off"
										value={psk}
										onChange={(event) => setPsk(event.target.value)}
										className="w-full"
									/>
									<Button
										variant="outlined"
										disabled={busy}
										onClick={() => {
											setBusy(true);
											setUpdateNote("");
											void run(startDeviceUpdate(current.device.uuid))
												.then((result) => {
													if (result?.started) {
														setUpdateNote(t("debug.updateStarted"));
													}
												})
												.finally(() => setBusy(false));
										}}
									>
										{t("debug.updateCompanion")}
									</Button>
									{updateNote ? (
										<Alert severity="success">{updateNote}</Alert>
									) : null}
									<Button
										variant="contained"
										disabled={busy || !ssid || !psk}
										onClick={() => void sendWifi()}
									>
										{t("wifi.signWifi")}
									</Button>
									{pasteText ? (
										<CopyBlock
											label={t("ble.signedCommand")}
											value={pasteText}
										/>
									) : null}
									<TextField
										label={t("admin.transferTo")}
										placeholder={
											session.data?.id || t("admin.transferPlaceholder")
										}
										value={toUserId}
										onChange={(event) => setToUserId(event.target.value)}
										className="w-full"
									/>
									<Button
										variant="outlined"
										disabled={busy}
										onClick={() => {
											const target = toUserId.trim() || session.data?.id || "";
											if (
												!window.confirm(
													t("admin.transferConfirm", {
														uuid: current.device.uuid,
														target: target || t("admin.thisAdmin"),
													}),
												)
											) {
												return;
											}
											setBusy(true);
											void run(
												adminTransfer({
													uuid: current.device.uuid,
													toUserId: toUserId.trim() || undefined,
												}),
											)
												.then((result) => {
													if (!result) {
														return;
													}
													setToUserId("");
													return run(listAdminDevices()).then(applyList);
												})
												.finally(() => setBusy(false));
										}}
									>
										{t("admin.forceTransfer")}
									</Button>
									<Button
										color="error"
										variant="text"
										disabled={busy}
										onClick={() => {
											if (
												!window.confirm(
													t("admin.unpairConfirmUuid", {
														uuid: current.device.uuid,
														owner:
															current.device.email ||
															current.device.login ||
															current.device.userId,
													}),
												)
											) {
												return;
											}
											setBusy(true);
											void run(adminUnpair(current.device.uuid))
												.then((result) => {
													if (!result) {
														return;
													}
													setSelected("");
													return run(listAdminDevices()).then(applyList);
												})
												.finally(() => setBusy(false));
										}}
									>
										{t("admin.unpairFromOwner")}
									</Button>
								</Stack>
							</Paper>
						) : null}
					</>
				) : null}
			</Stack>
		</ExpertGate>
	);
}
