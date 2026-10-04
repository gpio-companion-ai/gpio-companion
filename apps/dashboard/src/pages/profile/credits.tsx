import { GET as getCredits, POST as grantCredits } from "@api/credits";
import {
	PUT as capturePaypalOrder,
	POST as createPaypalOrder,
	GET as getPaypalConfig,
} from "@api/credits/paypal";
import { GET as getUsage } from "@api/credits/usage";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import { TablePagination } from "@shpaw415/mui-lite/Pagination";
import Paper from "@shpaw415/mui-lite/Paper";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Stack from "@shpaw415/mui-lite/Stack";
import Table, {
	TableBody,
	TableCell,
	TableContainer,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useRef, useState } from "react";
import UsageCharts from "../../components/UsageCharts.tsx";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useColorMode } from "../../hooks/useColorMode.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import { unwrapAction } from "../../lib/action.ts";
import {
	type AiUsageKind,
	type AiUsageSummary,
	USAGE_DAY_OPTIONS,
} from "../../lib/ai-usage.ts";
import { openLoginDialog } from "../../lib/auth/refresh.ts";
import { isAdmin } from "../../lib/auth/role.ts";
import {
	CREDIT_PACKS_USD,
	type CreditPackUsd,
} from "../../lib/credit-packs.ts";
import { formatUsd } from "../../lib/credits.ts";
import { loadPaypalSdk, paypalButtonsStyle } from "../../lib/paypal-sdk.ts";

type PaypalConfig = {
	configured: boolean;
	liveMode: boolean;
	clientId: string;
	packs: number[];
};

export default function CreditsPage() {
	const session = useAuthSession();
	const t = useT();
	const admin = isAdmin(session.data?.role);
	const [micros, setMicros] = useState<number | null>(null);
	const [creditsLoading, setCreditsLoading] = useState(true);
	const [paypal, setPaypal] = useState<PaypalConfig | null>(null);
	const [pack, setPack] = useState<CreditPackUsd>(10);
	const [error, setError] = useState("");
	const [status, setStatus] = useState("");
	const paypalMountRef = useRef<HTMLDivElement | null>(null);

	useEffect(() => {
		if (!session.data?.id) {
			setCreditsLoading(false);
			return;
		}
		setCreditsLoading(true);
		void Promise.all([getCredits(), getPaypalConfig()])
			.then(([creditsResult, paypalResult]) => {
				setMicros(unwrapAction(creditsResult).micros);
				setPaypal(unwrapAction(paypalResult));
			})
			.catch((caught: unknown) => {
				setError(
					translateError(
						t,
						caught instanceof Error ? caught.message : "load failed",
					),
				);
			})
			.finally(() => setCreditsLoading(false));
	}, [session.data?.id, t]);

	useEffect(() => {
		if (!paypal?.configured || !paypal.clientId) {
			return;
		}
		let cancelled = false;
		let buttons: {
			render: (el: HTMLElement) => Promise<void>;
			close: () => Promise<void>;
		} | null = null;
		async function mount() {
			const sdk = await loadPaypalSdk({
				clientId: paypal?.clientId ?? "",
				liveMode: paypal?.liveMode,
			});
			if (cancelled || !paypalMountRef.current) {
				return;
			}
			buttons = sdk.Buttons({
				style: paypalButtonsStyle(),
				createOrder: async () => {
					const created = unwrapAction(await createPaypalOrder(pack));
					return created.orderId;
				},
				onApprove: async (data) => {
					setError("");
					try {
						const next = unwrapAction(await capturePaypalOrder(data.orderID));
						setMicros(next.micros);
						setStatus(t("credits.added", { amount: pack.toFixed(2) }));
					} catch (caught: unknown) {
						setError(
							translateError(
								t,
								caught instanceof Error
									? caught.message
									: "PayPal capture failed",
							),
						);
					}
				},
				onError: (caught) => {
					setError(
						translateError(t, caught.message || "PayPal checkout failed"),
					);
				},
			});
			if (paypalMountRef.current) {
				await buttons.render(paypalMountRef.current);
			}
		}
		void mount().catch((caught: unknown) => {
			setError(
				translateError(
					t,
					caught instanceof Error ? caught.message : "Could not start PayPal",
				),
			);
		});
		return () => {
			cancelled = true;
			void buttons?.close();
			if (paypalMountRef.current) {
				paypalMountRef.current.innerHTML = "";
			}
		};
	}, [paypal?.configured, paypal?.clientId, paypal?.liveMode, pack, t]);

	if (!session.data?.id && !session.data?.email) {
		return (
			<Typography color="secondary">
				<Button onClick={openLoginDialog} variant="text">
					{t("auth.signIn")}
				</Button>{" "}
				{t("auth.toCredits")}
			</Typography>
		);
	}

	return (
		<Stack spacing={1.5}>
			<Paper className="w-full p-3" elevation={1}>
				<Stack spacing={2}>
					{creditsLoading ? (
						<Skeleton variant="rounded" height={30} width={130} />
					) : (
						<Typography variant="h5">
							{micros === null ? "…" : formatUsd(micros)}
						</Typography>
					)}
					<Typography variant="subtitle1">{t("credits.add")}</Typography>
					<Stack direction="row" spacing={1} className="flex-wrap gap-2">
						{CREDIT_PACKS_USD.map((usd) => (
							<Button
								key={usd}
								variant={pack === usd ? "contained" : "outlined"}
								onClick={() => setPack(usd)}
							>
								${usd}
							</Button>
						))}
					</Stack>
					{creditsLoading ? (
						<Skeleton variant="rounded" height={45} />
					) : paypal?.configured && paypal.clientId ? (
						<div ref={paypalMountRef} className="min-h-[45px] max-w-[280px]" />
					) : (
						<Alert severity="info">{t("credits.paypalMissing")}</Alert>
					)}
					{admin ? (
						<Button
							variant="outlined"
							className="w-full min-[900px]:w-auto"
							onClick={() => {
								setError("");
								void grantCredits(1)
									.then((result) => {
										setMicros(unwrapAction(result).micros);
										setStatus(t("credits.granted"));
									})
									.catch((caught: unknown) => {
										setError(
											translateError(
												t,
												caught instanceof Error
													? caught.message
													: "grant failed",
											),
										);
									});
							}}
						>
							{t("credits.adminStub")}
						</Button>
					) : null}
					{status ? <Alert severity="success">{status}</Alert> : null}
					{error ? <Alert severity="error">{error}</Alert> : null}
				</Stack>
			</Paper>
			<UsageSection userId={session.data?.id} />
		</Stack>
	);
}

function kindLabel(t: ReturnType<typeof useT>, kind: AiUsageKind): string {
	switch (kind) {
		case "embedding":
			return t("credits.usageKindEmbedding");
		case "stt":
			return t("credits.usageKindStt");
		case "tts":
			return t("credits.usageKindTts");
		default:
			return t("credits.usageKindChat");
	}
}

function usageDetail(
	kind: AiUsageKind,
	row: {
		promptTokens: number;
		completionTokens: number;
		audioSeconds: number | null;
		chars: number | null;
	},
): string {
	if (kind === "stt") {
		const minutes = row.audioSeconds == null ? 0 : row.audioSeconds / 60;
		return `${minutes.toFixed(2)} min`;
	}
	if (kind === "tts") {
		return `${(row.chars ?? 0).toLocaleString()} chars`;
	}
	if (kind === "embedding") {
		return `${row.promptTokens.toLocaleString()} tokens`;
	}
	return `${row.promptTokens.toLocaleString()} in / ${row.completionTokens.toLocaleString()} out`;
}

function UsageSection({ userId }: { userId: string | undefined }) {
	const t = useT();
	const { isDark } = useColorMode();
	const [days, setDays] = useState<number>(30);
	const [usage, setUsage] = useState<AiUsageSummary | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState("");
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState<10 | 25 | 50 | 100>(10);

	useEffect(() => {
		if (!userId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		setError("");
		setPage(0);
		void getUsage(days)
			.then((result) => {
				setUsage(unwrapAction(result));
			})
			.catch((caught: unknown) => {
				const message =
					caught instanceof Error ? caught.message : "load failed";
				setError(
					message === "usage history is not available"
						? t("credits.usageUnavailable")
						: translateError(t, message),
				);
			})
			.finally(() => setLoading(false));
	}, [userId, days, t]);

	if (!userId) {
		return null;
	}

	return (
		<Paper id="usage" className="w-full p-3" elevation={1}>
			<Stack spacing={2}>
				<Typography variant="subtitle1">{t("credits.usageTitle")}</Typography>
				<Typography color="secondary">{t("credits.usageHint")}</Typography>
				<Stack direction="row" spacing={1} className="flex-wrap gap-2">
					{USAGE_DAY_OPTIONS.map((option) => (
						<Button
							key={option}
							variant={days === option ? "contained" : "outlined"}
							size="small"
							onClick={() => setDays(option)}
						>
							{option}d
						</Button>
					))}
				</Stack>
				{loading ? (
					<Stack spacing={1}>
						<Skeleton variant="rounded" height={24} width={180} />
						<Skeleton variant="rounded" height={120} />
					</Stack>
				) : error ? (
					<Alert severity="error">{error}</Alert>
				) : !usage || usage.calls === 0 ? (
					<Alert severity="info">{t("credits.usageEmpty")}</Alert>
				) : (
					<>
						<Stack spacing={0.5}>
							<Typography variant="h5">{formatUsd(usage.micros)}</Typography>
							<Typography color="secondary">
								{t("credits.usageSpent")} ·{" "}
								{t("credits.usageCalls", { count: usage.calls })}
							</Typography>
						</Stack>
						<Stack direction="row" spacing={1} className="flex-wrap gap-2">
							{usage.byKind.map((entry) => (
								<Chip
									key={entry.kind}
									label={`${kindLabel(t, entry.kind)} · ${formatUsd(entry.micros)}`}
									variant="outlined"
									size="small"
								/>
							))}
						</Stack>
						<Typography variant="subtitle1">
							{t("credits.usageByModel")}
						</Typography>
						<UsageCharts summary={usage} dark={isDark} />
						<Typography variant="subtitle1">
							{t("credits.usageRecent")}
						</Typography>
						<Paper className="w-full p-3" elevation={0} variant="outlined">
							<Stack spacing={1.5}>
								<TableContainer>
									<Table size="small">
										<TableHead>
											<TableRow>
												<TableCell>{t("credits.usageWhen")}</TableCell>
												<TableCell>{t("credits.usageDetail")}</TableCell>
												<TableCell>{t("credits.usageCost")}</TableCell>
											</TableRow>
										</TableHead>
										<TableBody>
											{usage.recent
												.slice(
													page * rowsPerPage,
													page * rowsPerPage + rowsPerPage,
												)
												.map((entry) => (
													<TableRow
														key={`${entry.createdAt}:${entry.kind}:${entry.model}:${entry.micros}`}
													>
														<TableCell>
															{new Date(entry.createdAt).toLocaleString()}
														</TableCell>
														<TableCell>
															<span className="break-all">{entry.model}</span>{" "}
															<span className="opacity-70">
																({kindLabel(t, entry.kind)} ·{" "}
																{usageDetail(entry.kind, entry)})
															</span>
														</TableCell>
														<TableCell>{formatUsd(entry.micros)}</TableCell>
													</TableRow>
												))}
										</TableBody>
									</Table>
								</TableContainer>
								{usage.recent.length === 0 ? null : (
									<TablePagination
										count={usage.recent.length}
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
					</>
				)}
			</Stack>
		</Paper>
	);
}
