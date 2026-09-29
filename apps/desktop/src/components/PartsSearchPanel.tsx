import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import {
	type JlcpcbPartView,
	partsFromSearch,
	partsSearchBody,
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import { jlcpcbCredentialStatus, searchJlcpcbParts } from "../api";
import { useT } from "../locale";
import { LinesSkeleton } from "./skeletons";

type CredentialStatus = "loading" | "ready" | "missing" | "error";

const PROFILE_JUMP = "gpio-profile-jump";

export default function PartsSearchPanel() {
	const t = useT();
	const [status, setStatus] = useState<CredentialStatus>("loading");
	const [query, setQuery] = useState("");
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState("");
	const [parts, setParts] = useState<JlcpcbPartView[]>([]);
	const [searched, setSearched] = useState(false);
	const [copied, setCopied] = useState("");

	useEffect(() => {
		let cancelled = false;
		async function load() {
			try {
				const data = await jlcpcbCredentialStatus();
				if (cancelled) {
					return;
				}
				setStatus(data.configured ? "ready" : "missing");
				setError("");
			} catch (caught) {
				if (cancelled) {
					return;
				}
				setStatus("error");
				setError(caught instanceof Error ? caught.message : "request failed");
			}
		}
		void load();
		return () => {
			cancelled = true;
		};
	}, []);

	async function search() {
		const body = partsSearchBody(status === "ready", query);
		if (!body) {
			return;
		}
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
		<Paper sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("parts.title")}</Typography>
				<Typography color="secondary">{t("parts.hint")}</Typography>
				{status === "loading" ? <LinesSkeleton lines={2} /> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				{status === "missing" ? (
					<Typography color="secondary">
						{t("parts.needCredentials")}
					</Typography>
				) : null}
				{status === "ready" || status === "missing" ? (
					<Stack spacing={1}>
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
							disabled={busy || !partsSearchBody(status === "ready", query)}
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
				) : null}
			</Stack>
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

export function consumeProfileJump(): "address" | null {
	try {
		const jump = window.sessionStorage.getItem(PROFILE_JUMP);
		if (jump !== "address") {
			return null;
		}
		window.sessionStorage.removeItem(PROFILE_JUMP);
		return jump;
	} catch {
		return null;
	}
}
