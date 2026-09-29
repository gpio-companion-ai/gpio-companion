import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion-i18n";
import {
	type ShippingAddress,
	validateShippingAddress,
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import { loadShippingAddress, saveShippingAddress } from "../api";
import { useT } from "../locale";

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
		void loadShippingAddress()
			.then((data) => {
				const address = data.address as ShippingAddress | null;
				if (!cancelled && address?.name) {
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
			const data = await saveShippingAddress(fields);
			const address = data.address as ShippingAddress | undefined;
			if (!address) {
				setError("address is required");
				return;
			}
			setFields(fieldsFrom(address));
			setSaved(true);
			window.dispatchEvent(new Event("gpio-address-saved"));
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Paper id="profile-address" sx={{ p: 1.5 }} elevation={1}>
			<Stack spacing={1}>
				<Typography variant="subtitle1">{t("address.title")}</Typography>
				<Typography color="secondary">{t("address.hint")}</Typography>
				{saved ? <Alert severity="success">{t("address.saved")}</Alert> : null}
				{error ? (
					<Alert severity="error">{translateError(t, error)}</Alert>
				) : null}
				{(
					[
						["name", "name"],
						["line1", "line1"],
						["line2", "line2"],
						["city", "city"],
						["region", "region"],
						["postalCode", "postalCode"],
						["country", "country"],
					] as const
				).map(([key, label]) => (
					<TextField
						key={key}
						label={t(`address.${label}`)}
						value={fields[key]}
						disabled={busy}
						onChange={(event) => setField(key, event.target.value)}
					/>
				))}
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
