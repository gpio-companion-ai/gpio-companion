import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
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
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import {
	confirmJlcpcbOrder,
	jlcpcbCredentialStatus,
	loadShippingAddress,
	quoteJlcpcbOrder,
	searchJlcpcbParts,
} from "../api";
import { useT } from "../locale";
import JlcpcbDraft from "./JlcpcbDraft";
import { LinesSkeleton } from "./skeletons";

type Gate = "loading" | "ready" | "unavailable" | "error";
type Tab = "search" | "draft" | "order";

const EMPTY_DRAFT: JlcpcbOrderDraft = { kind: "pcb" };
const PROFILE_JUMP = "gpio-profile-jump";

export default function JlcpcbCard({
	onOpenProfile,
}: {
	onOpenProfile?: () => void;
}) {
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
					jlcpcbCredentialStatus(),
					loadShippingAddress(),
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
		<Paper sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Stack
					direction="row"
					spacing={1}
					sx={{
						flexWrap: "wrap",
						alignItems: "center",
						justifyContent: "space-between",
					}}
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
						<Stack direction="row" spacing={1}>
							<Button
								size="small"
								variant={tab === "search" ? "contained" : "outlined"}
								onClick={() => setTab("search")}
							>
								{t("jlcpcb.searchTab")}
							</Button>
							<Button
								size="small"
								variant={tab === "draft" ? "contained" : "outlined"}
								onClick={() => setTab("draft")}
							>
								{t("jlcpcb.draftTab")}
							</Button>
							{gate === "ready" ? (
								<Button
									size="small"
									variant={tab === "order" ? "contained" : "outlined"}
									onClick={() => setTab("order")}
								>
									{t("jlcpcb.orderTab")}
								</Button>
							) : null}
						</Stack>
						{tab === "draft" ? (
							<JlcpcbDraft />
						) : tab === "order" && gate === "ready" ? (
							<OrderSection
								configured={configured}
								address={address}
								onOpenProfile={onOpenProfile}
							/>
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
			const data = await searchJlcpcbParts(body.query);
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
	onOpenProfile,
}: {
	configured: boolean;
	address: ShippingAddress | null;
	onOpenProfile?: () => void;
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

	function openAddress() {
		try {
			window.sessionStorage.setItem(PROFILE_JUMP, "address");
		} catch {
			// session storage can be unavailable
		}
		window.dispatchEvent(new Event("gpio-profile-address"));
		onOpenProfile?.();
	}

	async function quoteOrder() {
		const body = orderQuoteBody(configured, draft);
		if (!body) return;
		setBusy(true);
		setError("");
		setQuote("");
		try {
			const data = await quoteJlcpcbOrder(body);
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
			await confirmJlcpcbOrder(body);
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
				<Button variant="outlined" size="small" onClick={openAddress}>
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
			sx={{
				flexWrap: "wrap",
				alignItems: "center",
				justifyContent: "space-between",
			}}
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
