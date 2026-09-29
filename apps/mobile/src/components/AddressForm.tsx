import {
	type ShippingAddress,
	validateShippingAddress,
} from "gpio-companion-jlcpcb";
import { useEffect, useState } from "react";
import { loadShippingAddress, saveShippingAddress } from "../lib/api.ts";
import { translateError, useT } from "../lib/locale.tsx";
import { Body, ErrorText, Field, Muted, Paper, PrimaryButton } from "./ui.tsx";

const EMPTY = {
	name: "",
	line1: "",
	line2: "",
	city: "",
	region: "",
	postalCode: "",
	country: "",
};

export default function AddressForm({ token }: { token: string | null }) {
	const t = useT();
	const [fields, setFields] = useState(EMPTY);
	const [busy, setBusy] = useState(false);
	const [saved, setSaved] = useState(false);
	const [error, setError] = useState("");

	useEffect(() => {
		if (!token) return;
		let cancelled = false;
		void loadShippingAddress(token)
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
	}, [token]);

	function setField(key: keyof typeof EMPTY, value: string) {
		setFields((current) => ({ ...current, [key]: value }));
	}

	async function save() {
		if (!token) {
			setError("sign in first");
			return;
		}
		setBusy(true);
		setSaved(false);
		setError("");
		try {
			validateShippingAddress(fields);
			const data = await saveShippingAddress(token, fields);
			const address = data.address as ShippingAddress | undefined;
			if (!address) {
				setError("address is required");
				return;
			}
			setFields(fieldsFrom(address));
			setSaved(true);
		} catch (caught) {
			setError(caught instanceof Error ? caught.message : "request failed");
		} finally {
			setBusy(false);
		}
	}

	return (
		<Paper>
			<Body>{t("address.title")}</Body>
			<Muted>{t("address.hint")}</Muted>
			{saved ? <Muted>{t("address.saved")}</Muted> : null}
			<ErrorText>{translateError(t, error)}</ErrorText>
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
				<Field
					key={key}
					label={t(`address.${label}`)}
					value={fields[key]}
					onChangeText={(value) => setField(key, value)}
				/>
			))}
			<PrimaryButton
				label={busy ? t("address.saving") : t("address.save")}
				disabled={busy || !token}
				onPress={() => void save()}
			/>
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
