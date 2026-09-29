import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { type ShippingAddress, validateShippingAddress } from "gpio-companion";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";

const EMPTY = {
	name: "",
	line1: "",
	line2: "",
	city: "",
	region: "",
	postalCode: "",
	country: "",
};

export default function AddressForm() {
	const t = useT();
	const [fields, setFields] = useState(EMPTY);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		let cancelled = false;
		void fetch("/api/address", { headers: { accept: "application/json" } })
			.then(async (response) => {
				const payload = (await response.json().catch(() => null)) as {
					ok?: boolean;
					data?: { address?: ShippingAddress | null };
				} | null;
				const address = payload?.ok ? payload.data?.address : null;
				if (!cancelled && address) {
					setFields(fieldsFrom(address));
				}
			})
			.catch(() => undefined);
		return () => {
			cancelled = true;
		};
	}, []);

	function setField(key: keyof typeof EMPTY, value: string) {
		setFields((current) => ({ ...current, [key]: value }));
	}

	async function save() {
		setBusy(true);
		setSaved(false);
		setError("");
		try {
			validateShippingAddress(fields);
			const response = await fetch("/api/address", {
				method: "PUT",
				headers: {
					accept: "application/json",
					"content-type": "application/json",
				},
				body: JSON.stringify(fields),
			});
			const payload = (await response.json().catch(() => null)) as {
				ok?: boolean;
				error?: string;
				data?: { address?: ShippingAddress };
			} | null;
			if (!payload?.ok || !payload.data?.address) {
				setError(payload?.error || "address is required");
				return;
			}
			setFields(fieldsFrom(payload.data.address));
			setSaved(true);
			window.dispatchEvent(new Event("gpio-address-saved"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Paper id="address" className="w-full p-3" elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("address.title")}</Typography>
				<Typography color="secondary">{t("address.hint")}</Typography>
				{saved ? <Alert severity="success">{t("address.saved")}</Alert> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				<TextField
					label={t("address.name")}
					value={fields.name}
					disabled={busy}
					onChange={(event) => setField("name", event.target.value)}
				/>
				<TextField
					label={t("address.line1")}
					value={fields.line1}
					disabled={busy}
					onChange={(event) => setField("line1", event.target.value)}
				/>
				<TextField
					label={t("address.line2")}
					value={fields.line2}
					disabled={busy}
					onChange={(event) => setField("line2", event.target.value)}
				/>
				<TextField
					label={t("address.city")}
					value={fields.city}
					disabled={busy}
					onChange={(event) => setField("city", event.target.value)}
				/>
				<TextField
					label={t("address.region")}
					value={fields.region}
					disabled={busy}
					onChange={(event) => setField("region", event.target.value)}
				/>
				<TextField
					label={t("address.postalCode")}
					value={fields.postalCode}
					disabled={busy}
					onChange={(event) => setField("postalCode", event.target.value)}
				/>
				<TextField
					label={t("address.country")}
					value={fields.country}
					disabled={busy}
					onChange={(event) => setField("country", event.target.value)}
				/>
				<Button
					variant="contained"
					size="small"
					disabled={busy}
					onClick={() => void save()}
				>
					{busy ? t("address.saving") : t("address.save")}
				</Button>
			</Stack>
		</Paper>
	);
}

function fieldsFrom(address: ShippingAddress) {
	return {
		name: address.name,
		line1: address.line1,
		line2: address.line2 ?? "",
		city: address.city,
		region: address.region ?? "",
		postalCode: address.postalCode,
		country: address.country,
	};
}
