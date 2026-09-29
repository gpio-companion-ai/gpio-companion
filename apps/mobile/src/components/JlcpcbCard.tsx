import { useFocusEffect, useRouter } from "expo-router";
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
import { useCallback, useState } from "react";
import { Clipboard, View } from "react-native";
import {
	confirmJlcpcbOrder,
	jlcpcbCredentialStatus,
	loadShippingAddress,
	quoteJlcpcbOrder,
	searchJlcpcbParts,
} from "../lib/api.ts";
import { useDeckNav } from "../lib/deck-nav.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import JlcpcbDraft from "./JlcpcbDraft.tsx";
import {
	Body,
	Chip,
	ErrorText,
	Field,
	Muted,
	Paper,
	PrimaryButton,
	Row,
	Skeleton,
	TextButton,
} from "./ui.tsx";

type Gate = "loading" | "ready" | "unavailable" | "error";
type Tab = "search" | "draft" | "order";

const EMPTY_DRAFT: JlcpcbOrderDraft = { kind: "pcb" };

export default function JlcpcbCard({ token }: { token: string | null }) {
	const t = useT();
	const [gate, setGate] = useState<Gate>("loading");
	const [configured, setConfigured] = useState(false);
	const [address, setAddress] = useState<ShippingAddress | null>(null);
	const [error, setError] = useState("");
	const [tab, setTab] = useState<Tab>("search");

	useFocusEffect(
		useCallback(() => {
			if (!token) {
				setGate("error");
				setError("sign in first");
				return;
			}
			let cancelled = false;
			void Promise.all([
				jlcpcbCredentialStatus(token),
				loadShippingAddress(token),
			])
				.then(([credentials, stored]) => {
					if (cancelled) return;
					const nextConfigured = Boolean(credentials.configured);
					setConfigured(nextConfigured);
					setAddress(shippingAddressFrom(stored.address));
					setGate(nextConfigured ? "ready" : "unavailable");
					setError("");
				})
				.catch((caught) => {
					if (cancelled) return;
					setGate("error");
					setError(caught instanceof Error ? caught.message : "request failed");
				});
			return () => {
				cancelled = true;
			};
		}, [token]),
	);

	return (
		<Paper>
			<Row>
				<Body>{t("jlcpcb.title")}</Body>
				{gate === "loading" ? (
					<Chip label={t("jlcpcb.loading")} tone="muted" />
				) : gate === "ready" ? (
					<Chip label={t("jlcpcb.available")} tone="success" />
				) : (
					<Chip label={t("jlcpcb.unavailable")} tone="muted" />
				)}
			</Row>
			<Muted>{t("jlcpcb.hint")}</Muted>
			{gate === "loading" ? <Skeleton height={48} /> : null}
			<ErrorText>{translateError(t, error)}</ErrorText>
			{gate === "unavailable" ? (
				<Muted>{t("parts.needCredentials")}</Muted>
			) : null}
			{gate !== "loading" && token ? (
				<View style={{ gap: 8 }}>
					<Row>
						{tab === "search" ? (
							<PrimaryButton
								label={t("jlcpcb.searchTab")}
								onPress={() => setTab("search")}
							/>
						) : (
							<TextButton
								label={t("jlcpcb.searchTab")}
								onPress={() => setTab("search")}
							/>
						)}
						{tab === "draft" ? (
							<PrimaryButton
								label={t("jlcpcb.draftTab")}
								onPress={() => setTab("draft")}
							/>
						) : (
							<TextButton
								label={t("jlcpcb.draftTab")}
								onPress={() => setTab("draft")}
							/>
						)}
						{gate === "ready" ? (
							tab === "order" ? (
								<PrimaryButton
									label={t("jlcpcb.orderTab")}
									onPress={() => setTab("order")}
								/>
							) : (
								<TextButton
									label={t("jlcpcb.orderTab")}
									onPress={() => setTab("order")}
								/>
							)
						) : null}
					</Row>
					{tab === "draft" ? (
						<JlcpcbDraft token={token} />
					) : tab === "order" && gate === "ready" ? (
						<OrderSection
							token={token}
							configured={configured}
							address={address}
						/>
					) : (
						<SearchSection token={token} configured={configured} />
					)}
				</View>
			) : null}
		</Paper>
	);
}

function SearchSection({
	token,
	configured,
}: {
	token: string;
	configured: boolean;
}) {
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
			const data = await searchJlcpcbParts(token, body.query);
			setParts(partsFromSearch(data));
			setSearched(true);
		} catch (caught) {
			setParts([]);
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<View style={{ gap: 8 }}>
			<Muted>{t("parts.hint")}</Muted>
			<ErrorText>{translateError(t, error)}</ErrorText>
			<Field
				label={t("parts.query")}
				value={query}
				placeholder={t("parts.queryPlaceholder")}
				onChangeText={setQuery}
			/>
			<PrimaryButton
				label={busy ? t("parts.searching") : t("parts.search")}
				disabled={busy || !partsSearchBody(configured, query)}
				onPress={() => void search()}
			/>
			{searched && parts.length === 0 ? (
				<Muted>{t("parts.empty")}</Muted>
			) : null}
			{parts.map((part) => (
				<PartRow
					key={part.componentCode}
					part={part}
					copied={copied === part.componentCode}
					onCopy={() => {
						Clipboard.setString(part.componentCode);
						setCopied(part.componentCode);
					}}
				/>
			))}
		</View>
	);
}

function OrderSection({
	token,
	configured,
	address,
}: {
	token: string;
	configured: boolean;
	address: ShippingAddress | null;
}) {
	const t = useT();
	const router = useRouter();
	const { jumpProfile } = useDeckNav();
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
		jumpProfile("address");
		router.navigate("/profile");
	}

	async function quoteOrder() {
		const body = orderQuoteBody(configured, draft);
		if (!body) return;
		setBusy(true);
		setError("");
		setQuote("");
		try {
			const data = await quoteJlcpcbOrder(token, body);
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
			await confirmJlcpcbOrder(token, body);
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
		<View style={{ gap: 8 }}>
			<Muted>{t("order.hint")}</Muted>
			<ErrorText>{translateError(t, error)}</ErrorText>
			{placed ? <Muted>{t("order.placed")}</Muted> : null}
			{cancelled ? <Muted>{t("order.cancelled")}</Muted> : null}
			{!address ? <Muted>{t("order.needAddress")}</Muted> : null}
			{!address ? (
				<TextButton label={t("order.openAddress")} onPress={openAddress} />
			) : null}
			<View style={{ flexDirection: "row", gap: 8 }}>
				<TextButton
					label={t("order.pcb")}
					onPress={() => setField("kind", "pcb")}
				/>
				<TextButton
					label={t("order.tdp")}
					onPress={() => setField("kind", "tdp")}
				/>
			</View>
			{draft.kind === "tdp" ? (
				<>
					<Field
						label={t("order.fileAccessId")}
						value={draft.fileAccessId ?? ""}
						onChangeText={(value) => setField("fileAccessId", value)}
					/>
					<Field
						label={t("order.itemCount")}
						value={draft.itemCount ?? ""}
						onChangeText={(value) => setField("itemCount", value)}
					/>
				</>
			) : (
				<>
					<Field
						label={t("order.fileKey")}
						value={draft.fileKey ?? ""}
						onChangeText={(value) => setField("fileKey", value)}
					/>
					<Field
						label={t("order.orderType")}
						value={draft.orderType ?? ""}
						onChangeText={(value) => setField("orderType", value)}
					/>
					<Field
						label={t("order.layer")}
						value={draft.layer ?? ""}
						onChangeText={(value) => setField("layer", value)}
					/>
					<Field
						label={t("order.qty")}
						value={draft.qty ?? ""}
						onChangeText={(value) => setField("qty", value)}
					/>
					<Field
						label={t("order.thickness")}
						value={draft.thickness ?? ""}
						onChangeText={(value) => setField("thickness", value)}
					/>
				</>
			)}
			{!reviewing ? (
				<PrimaryButton
					label={t("order.review")}
					disabled={busy}
					onPress={() => {
						setCancelled(false);
						setReviewing(true);
					}}
				/>
			) : (
				<View style={{ gap: 8 }}>
					<Muted>
						{draft.kind === "tdp" ? t("order.tdp") : t("order.pcb")}
					</Muted>
					{address ? <Muted>{formatShippingAddress(address)}</Muted> : null}
					{quote ? (
						<Muted>
							{t("order.quoteResult")}: {quote}
						</Muted>
					) : null}
					<TextButton
						label={busy ? t("order.quoting") : t("order.quote")}
						disabled={busy || !orderQuoteBody(configured, draft)}
						onPress={() => void quoteOrder()}
					/>
					<PrimaryButton
						label={busy ? t("order.confirming") : t("order.confirm")}
						disabled={busy || !confirmBody}
						onPress={() => void confirmOrder()}
					/>
					<TextButton
						label={t("order.cancel")}
						disabled={busy}
						onPress={cancelOrder}
					/>
				</View>
			)}
		</View>
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
		<View style={{ gap: 4 }}>
			<Body>{part.componentCode}</Body>
			{meta.length ? <Muted>{meta.join(" · ")}</Muted> : null}
			<TextButton
				label={copied ? t("common.copied") : t("parts.copyId")}
				onPress={onCopy}
			/>
		</View>
	);
}
