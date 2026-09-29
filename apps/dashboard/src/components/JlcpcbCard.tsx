import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	formatShippingAddress,
	type JlcpcbOrderDraft,
	type JlcpcbPartView,
	orderConfirmBody,
	orderQuoteBody,
	partsFromSearch,
	partsSearchBody,
	type ShippingAddress,
	shippingAddressFrom,
} from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import JlcpcbDraft from "./JlcpcbDraft.tsx";
import { LinesSkeleton } from "./skeletons.tsx";

type Gate = "loading" | "ready" | "unavailable" | "error";
type Tab = "search" | "draft" | "order";

const EMPTY_DRAFT: JlcpcbOrderDraft = { kind: "pcb" };

export default function JlcpcbCard() {
	const t = useT();
	const [gate, setGate] = useState<Gate>("loading");
	const [configured, setConfigured] = useState(false);
	const [address, setAddress] = useState<ShippingAddress | null>(null);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<Tab>("search");

	useEffect(() => {
		let cancelled = false;
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
				if (cancelled) return;
				const nextConfigured = Boolean(credentials.configured);
				setConfigured(nextConfigured);
				setAddress(shippingAddressFrom(stored.address));
				setGate(nextConfigured ? "ready" : "unavailable");
				setError("");
			} catch (caught) {
				if (cancelled) return;
				setGate("error");
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
			cancelled = true;
			window.removeEventListener("gpio-address-saved", refresh);
			window.removeEventListener("focus", refresh);
		};
	}, []);

	return (
		<Paper className="w-full p-3" elevation={1}>
			<Stack spacing={1}>
				<Stack
					direction="row"
					spacing={1}
					className="flex-wrap items-center justify-between"
				>
					<Typography variant="subtitle1">{t("jlcpcb.title")}</Typography>
					{gate === "loading" ? (
						<Chip label={t("jlcpcb.loading")} size="small" variant="outlined" />
					) : gate === "ready" ? (
						<Chip
							label={t("jlcpcb.available")}
							size="small"
							variant="outlined"
							color="success"
						/>
					) : (
						<Chip
							label={t("jlcpcb.unavailable")}
							size="small"
							variant="outlined"
						/>
					)}
				</Stack>
				<Typography color="secondary">{t("jlcpcb.hint")}</Typography>
				{gate === "loading" ? <LinesSkeleton lines={2} /> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				{gate === "unavailable" ? (
					<Typography color="secondary">
						{t("parts.needCredentials")}
					</Typography>
				) : null}
				{gate !== "loading" ? (
					<Stack spacing={1}>
						<Stack direction="row" spacing={1} role="tablist">
							<Button
								size="small"
								variant={tab === "search" ? "contained" : "outlined"}
								aria-pressed={tab === "search"}
								onClick={() => setTab("search")}
							>
								{t("jlcpcb.searchTab")}
							</Button>
							<Button
								size="small"
								variant={tab === "draft" ? "contained" : "outlined"}
								aria-pressed={tab === "draft"}
								onClick={() => setTab("draft")}
							>
								{t("jlcpcb.draftTab")}
							</Button>
							{gate === "ready" ? (
								<Button
									size="small"
									variant={tab === "order" ? "contained" : "outlined"}
									aria-pressed={tab === "order"}
									onClick={() => setTab("order")}
								>
									{t("jlcpcb.orderTab")}
								</Button>
							) : null}
						</Stack>
						{tab === "draft" ? (
							<JlcpcbDraft />
						) : tab === "order" && gate === "ready" ? (
							<OrderSection configured={configured} address={address} />
						) : (
							<SearchSection configured={configured} />
						)}
					</Stack>
				) : null}
			</Stack>
		</Paper>
	);
}

function SearchSection({ configured }: { configured: boolean }) {
	const t = useT();
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [parts, setParts] = useState<JlcpcbPartView[]>([]);
	const [searched, setSearched] = useState(false);
	const [copied, setCopied] = useState("");

	async function search() {
		const body = partsSearchBody(configured, query);
		if (!body) return;
		setBusy(true);
		setError("");
		setSearched(false);
		try {
			const data = await readData<{ parts?: unknown }>(
				await fetch("/api/jlcpcb/parts", {
					method: "POST",
					headers: {
						accept: "application/json",
						"content-type": "application/json",
					},
					body: JSON.stringify(body),
				}),
			);
			setParts(partsFromSearch(data));
			setSearched(true);
		} catch (caught) {
			setParts([]);
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	async function copyId(id: string) {
		await navigator.clipboard.writeText(id).catch(() => undefined);
		setCopied(id);
	}

	return (
		<Stack spacing={1}>
			<Typography color="secondary">{t("parts.hint")}</Typography>
			{error ? (
				<Alert severity="error">{translateError(t, error)}</Alert>
			) : null}
			<TextField
				label={t("parts.query")}
				placeholder={t("parts.queryPlaceholder")}
				value={query}
				disabled={busy}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (event.key === "Enter") {
						event.preventDefault();
						void search();
					}
				}}
			/>
			<Button
				variant="contained"
				size="small"
				disabled={busy || !partsSearchBody(configured, query)}
				onClick={() => void search()}
			>
				{busy ? t("parts.searching") : t("parts.search")}
			</Button>
			{searched && parts.length === 0 ? (
				<Typography color="secondary">{t("parts.empty")}</Typography>
			) : null}
			{parts.map((part) => (
				<PartRow
					key={part.componentCode}
					part={part}
					copied={copied === part.componentCode}
					onCopy={() => void copyId(part.componentCode)}
				/>
			))}
		</Stack>
	);
}

function OrderSection({
	configured,
	address,
}: {
	configured: boolean;
	address: ShippingAddress | null;
}) {
	const t = useT();
	const [draft, setDraft] = useState<JlcpcbOrderDraft>(EMPTY_DRAFT);
	const [reviewing, setReviewing] = useState(false);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [quote, setQuote] = useState("");
	const [placed, setPlaced] = useState(false);
	const [cancelled, setCancelled] = useState(false);

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
		<Stack spacing={1}>
			<Typography color="secondary">{t("order.hint")}</Typography>
			{error ? (
				<Alert severity="error">{translateError(t, error)}</Alert>
			) : null}
			{placed ? <Alert severity="success">{t("order.placed")}</Alert> : null}
			{cancelled ? <Alert severity="info">{t("order.cancelled")}</Alert> : null}
			{!address ? (
				<Typography color="secondary">{t("order.needAddress")}</Typography>
			) : null}
			{!address ? (
				<Button href="/profile#address" variant="outlined" size="small">
					{t("order.openAddress")}
				</Button>
			) : null}
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
						onChange={(event) => setField("fileAccessId", event.target.value)}
					/>
					<TextField
						label={t("order.itemCount")}
						value={draft.itemCount ?? ""}
						disabled={busy}
						onChange={(event) => setField("itemCount", event.target.value)}
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
						onChange={(event) => setField("orderType", event.target.value)}
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
						onChange={(event) => setField("thickness", event.target.value)}
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
	);
}

function PartRow({
	part,
	copied,
	onCopy,
}: {
	part: JlcpcbPartView;
	copied: boolean;
	onCopy: () => void;
}) {
	const t = useT();
	const meta = [
		part.name,
		part.package,
		part.stock === undefined ? "" : `${t("parts.stock")} ${part.stock}`,
		part.price === undefined ? "" : `${t("parts.price")} ${part.price}`,
	].filter(Boolean);
	return (
		<Stack
			direction="row"
			spacing={1}
			className="flex-wrap items-center justify-between"
		>
			<Stack spacing={0.25}>
				<Typography>{part.componentCode}</Typography>
				{meta.length ? (
					<Typography color="secondary">{meta.join(" · ")}</Typography>
				) : null}
			</Stack>
			<Button variant="text" size="small" onClick={onCopy}>
				{copied ? t("common.copied") : t("parts.copyId")}
			</Button>
		</Stack>
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
