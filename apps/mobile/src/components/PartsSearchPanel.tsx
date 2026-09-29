import { useFocusEffect } from "expo-router";
import {
	type JlcpcbPartView,
	partsFromSearch,
	partsSearchBody,
} from "gpio-companion-jlcpcb";
import { useCallback, useState } from "react";
import { Clipboard, View } from "react-native";
import { jlcpcbCredentialStatus, searchJlcpcbParts } from "../lib/api.ts";
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

type CredentialStatus = "loading" | "ready" | "missing" | "error";

export default function PartsSearchPanel({ token }: { token: string | null }) {
	const t = useT();
	const [status, setStatus] = useState<CredentialStatus>("loading");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [parts, setParts] = useState<JlcpcbPartView[]>([]);
	const [searched, setSearched] = useState(false);
	const [copied, setCopied] = useState("");

	useFocusEffect(
		useCallback(() => {
			if (!token) {
				setStatus("error");
				setError("sign in first");
				return;
			}
			let cancelled = false;
			void jlcpcbCredentialStatus(token)
				.then((data) => {
					if (cancelled) {
						return;
					}
					setStatus(data.configured ? "ready" : "missing");
					setError("");
				})
				.catch((caught) => {
					if (cancelled) {
						return;
					}
					setStatus("error");
					setError(caught instanceof Error ? caught.message : "request failed");
				});
			return () => {
				cancelled = true;
			};
		}, [token]),
	);

	async function search() {
		const body = partsSearchBody(status === "ready", query);
		if (!body || !token) {
			return;
		}
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
		<Paper>
			<Body>{t("parts.title")}</Body>
			<Muted>{t("parts.hint")}</Muted>
			{status === "loading" ? <Skeleton height={48} /> : null}
			<ErrorText>{translateError(t, error)}</ErrorText>
			{status === "missing" ? (
				<Muted>{t("parts.needCredentials")}</Muted>
			) : null}
			{status === "ready" ? (
				<View style={{ gap: 8 }}>
					<Field
						label={t("parts.query")}
						value={query}
						placeholder={t("parts.queryPlaceholder")}
						onChangeText={setQuery}
					/>
					<PrimaryButton
						label={busy ? t("parts.searching") : t("parts.search")}
						disabled={busy || !partsSearchBody(true, query)}
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
			) : null}
		</Paper>
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
