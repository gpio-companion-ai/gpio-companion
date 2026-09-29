import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	formatShippingAddress,
	type JlcpcbOrderDraft,
	orderConfirmBody,
	orderQuoteBody,
	type ShippingAddress,
	shippingAddressFrom,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { LinesSkeleton } from "./skeletons.tsx";

type Gate = "loading" | "ready" | "blocked";

const EMPTY: JlcpcbOrderDraft = { kind: "pcb" };

export default function OrderReviewPanel() {
	const t = useT();
	const [gate, setGate] = useState<Gate>("loading");
	const [configured, setConfigured] = useState(false);
	const [address, setAddress] = useState<ShippingAddress | null>(null);
	const [draft, setDraft] = useState<JlcpcbOrderDraft>(EMPTY);
	const [reviewing, setReviewing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [quote, setQuote] = useState("");
	const [placed, setPlaced] = useState(false);
	const [cancelled, setCancelled] = useState(false);

	useEffect(() => {
		let cancelledLoad = false;
		async function load() {
			try {
				const [credentials, stored] = await Promise.all([
					readData<{ configured?: boolean }>(
						await fetch("/api/jlcpcb/credentials", {
							headers: { accept: "application/json" },
						}),
					),
					readData<{ address?: ShippingAddress | null }>(
						await fetch("/api/address", {
							headers: { accept: "application/json" },
						}),
					),
				]);
				if (cancelledLoad) return;
				const nextAddress = shippingAddressFrom(stored.address);
				const nextConfigured = Boolean(credentials.configured);
				setConfigured(nextConfigured);
				setAddress(nextAddress);
				setGate(nextConfigured && nextAddress ? "ready" : "blocked");
				setError("");
			} catch (caught) {
				if (cancelledLoad) return;
				setGate("blocked");
				setError(caught instanceof Error ? caught.message : "request failed");
			}
		}
		void load();
		function refresh() {
			void load();
		}
		window.addEventListener("gpio-address-saved", refresh);
		window.addEventListener("focus", refresh);
		return () => {
			cancelledLoad = true;
			window.removeEventListener("gpio-address-saved", refresh);
			window.removeEventListener("focus", refresh);
		};
	}, []);

	function setField(key: keyof JlcpcbOrderDraft, value: string) {
		setDraft((current) => ({ ...current, [key]: value }));
		setReviewing(false);
		setPlaced(false);
		setCancelled(false);
	}

	async function quoteOrder() {
		const body = orderQuoteBody(configured, draft);
		if (!body) return;
		setBusy(true);
		setError("");
		setQuote("");
		try {
			const data = await readData<{ quote?: unknown }>(
				await fetch("/api/jlcpcb/orders/quote", {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				}),
			);
			setQuote(JSON.stringify(data.quote ?? null));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	async function confirmOrder() {
		const body = orderConfirmBody(configured, address, draft, true);
		if (!body) return;
		setBusy(true);
		setError("");
		setPlaced(false);
		try {
			await readData(
				await fetch("/api/jlcpcb/orders", {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				}),
			);
			setPlaced(true);
			setReviewing(false);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	function cancelOrder() {
		setReviewing(false);
		setQuote("");
		setPlaced(false);
		setCancelled(true);
		setError("");
	}

	const confirmBody = orderConfirmBody(configured, address, draft, true);

	return (
		<Paper className="w-full p-3" elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("order.title")}</Typography>
				<Typography color="secondary">{t("order.hint")}</Typography>
				{gate === "loading" ? <LinesSkeleton lines={2} /> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				{placed ? <Alert severity="success">{t("order.placed")}</Alert> : null}
				{cancelled ? (
					<Alert severity="info">{t("order.cancelled")}</Alert>
				) : null}
				{!configured && gate !== "loading" ? (
					<Typography color="secondary">
						{t("order.needCredentials")}
					</Typography>
				) : null}
				{!address && gate !== "loading" ? (
					<Typography color="secondary">{t("order.needAddress")}</Typography>
				) : null}
				{configured && !address ? (
					<Button href="/profile#address" variant="outlined" size="small">
						{t("order.openAddress")}
					</Button>
				) : null}
				{configured ? (
					<Stack spacing={1}>
						<Stack direction="row" spacing={1}>
							<Button
								size="small"
								variant={draft.kind === "pcb" ? "contained" : "outlined"}
								disabled={busy}
								onClick={() => setField("kind", "pcb")}
							>
								{t("order.pcb")}
							</Button>
							<Button
								size="small"
								variant={draft.kind === "tdp" ? "contained" : "outlined"}
								disabled={busy}
								onClick={() => setField("kind", "tdp")}
							>
								{t("order.tdp")}
							</Button>
						</Stack>
						{draft.kind === "tdp" ? (
							<>
								<TextField
									label={t("order.fileAccessId")}
									value={draft.fileAccessId ?? ""}
									disabled={busy}
									onChange={(event) =>
										setField("fileAccessId", event.target.value)
									}
								/>
								<TextField
									label={t("order.itemCount")}
									value={draft.itemCount ?? ""}
									disabled={busy}
									onChange={(event) =>
										setField("itemCount", event.target.value)
									}
								/>
							</>
						) : (
							<>
								<TextField
									label={t("order.fileKey")}
									value={draft.fileKey ?? ""}
									disabled={busy}
									onChange={(event) => setField("fileKey", event.target.value)}
								/>
								<TextField
									label={t("order.orderType")}
									value={draft.orderType ?? ""}
									disabled={busy}
									onChange={(event) =>
										setField("orderType", event.target.value)
									}
								/>
								<TextField
									label={t("order.layer")}
									value={draft.layer ?? ""}
									disabled={busy}
									onChange={(event) => setField("layer", event.target.value)}
								/>
								<TextField
									label={t("order.qty")}
									value={draft.qty ?? ""}
									disabled={busy}
									onChange={(event) => setField("qty", event.target.value)}
								/>
								<TextField
									label={t("order.thickness")}
									value={draft.thickness ?? ""}
									disabled={busy}
									onChange={(event) =>
										setField("thickness", event.target.value)
									}
								/>
							</>
						)}
						{!reviewing ? (
							<Button
								variant="outlined"
								size="small"
								disabled={busy}
								onClick={() => {
									setCancelled(false);
									setReviewing(true);
								}}
							>
								{t("order.review")}
							</Button>
						) : (
							<Stack spacing={1}>
								<Typography>{t("order.kind")}</Typography>
								<Typography color="secondary">
									{draft.kind === "tdp" ? t("order.tdp") : t("order.pcb")}
								</Typography>
								{address ? (
									<Typography color="secondary">
										{formatShippingAddress(address)}
									</Typography>
								) : null}
								{quote ? (
									<Typography color="secondary">
										{t("order.quoteResult")}: {quote}
									</Typography>
								) : null}
								<Button
									variant="outlined"
									size="small"
									disabled={busy || !orderQuoteBody(configured, draft)}
									onClick={() => void quoteOrder()}
								>
									{busy ? t("order.quoting") : t("order.quote")}
								</Button>
								<Stack direction="row" spacing={1}>
									<Button
										variant="contained"
										size="small"
										disabled={busy || !confirmBody}
										onClick={() => void confirmOrder()}
									>
										{busy ? t("order.confirming") : t("order.confirm")}
									</Button>
									<Button
										variant="text"
										size="small"
										disabled={busy}
										onClick={cancelOrder}
									>
										{t("order.cancel")}
									</Button>
								</Stack>
							</Stack>
						)}
					</Stack>
				) : null}
			</Stack>
		</Paper>
	);
}

async function readData<T>(response: Response): Promise<T> {
	const payload = (await response.json().catch(() => null)) as {
		ok?: boolean;
		error?: string;
		data?: T;
	} | null;
	if (!payload?.ok || payload.data === undefined) {
		throw new Error(payload?.error || "request failed");
	}
	return payload.data;
}
