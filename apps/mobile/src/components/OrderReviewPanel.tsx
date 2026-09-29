import { useRouter } from "expo-router";
import {
	formatShippingAddress,
	type JlcpcbOrderDraft,
	orderConfirmBody,
	orderQuoteBody,
	type ShippingAddress,
	shippingAddressFrom,
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import { View } from "react-native";
import {
	confirmJlcpcbOrder,
	jlcpcbCredentialStatus,
	loadShippingAddress,
	quoteJlcpcbOrder,
} from "../lib/api.ts";
import { useDeckNav } from "../lib/deck-nav.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import {
	Body,
	ErrorText,
	Field,
	Muted,
	Paper,
	PrimaryButton,
	Skeleton,
	TextButton,
} from "./ui.tsx";

const EMPTY: JlcpcbOrderDraft = { kind: "pcb" };

export default function OrderReviewPanel({ token }: { token: string | null }) {
	const t = useT();
	const router = useRouter();
	const { jumpProfile } = useDeckNav();
	const [loading, setLoading] = useState(true);
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
		if (!token) {
			setLoading(false);
			setError("sign in first");
			return;
		}
		let cancelledLoad = false;
		void Promise.all([
			jlcpcbCredentialStatus(token),
			loadShippingAddress(token),
		])
			.then(([credentials, stored]) => {
				if (cancelledLoad) return;
				setConfigured(credentials.configured);
				setAddress(shippingAddressFrom(stored.address));
				setError("");
			})
			.catch((caught) => {
				if (cancelledLoad) return;
				setError(caught instanceof Error ? caught.message : "request failed");
			})
			.finally(() => {
				if (!cancelledLoad) setLoading(false);
			});
		return () => {
			cancelledLoad = true;
		};
	}, [token]);

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
		if (!body || !token) return;
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
		if (!body || !token) return;
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
		<Paper>
			<Body>{t("order.title")}</Body>
			<Muted>{t("order.hint")}</Muted>
			{loading ? <Skeleton height={48} /> : null}
			<ErrorText>{translateError(t, error)}</ErrorText>
			{placed ? <Muted>{t("order.placed")}</Muted> : null}
			{cancelled ? <Muted>{t("order.cancelled")}</Muted> : null}
			{!configured && !loading ? (
				<Muted>{t("order.needCredentials")}</Muted>
			) : null}
			{!address && !loading ? <Muted>{t("order.needAddress")}</Muted> : null}
			{configured && !address ? (
				<TextButton label={t("order.openAddress")} onPress={openAddress} />
			) : null}
			{configured ? (
				<View style={{ gap: 8 }}>
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
			) : null}
		</Paper>
	);
}
