import { GET } from "@api/admin/shipping";
import Alert from "@shpaw415/mui-lite/Alert";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Table, {
	TableBody,
	TableCell,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useState } from "react";
import AdminSection from "../../../components/AdminSection.tsx";
import { useLocale, useT } from "../../../hooks/useLocale.tsx";
import { formatCents } from "../../../lib/format.ts";

type ShippingStatus = Awaited<ReturnType<typeof GET>>;

function formatOrigin(
	origin: NonNullable<ShippingStatus["easyship"]["origin"]>,
): string {
	return [
		origin.line1,
		origin.line2,
		[origin.city, origin.region, origin.postalCode].filter(Boolean).join(" "),
		origin.country,
	]
		.filter(Boolean)
		.join(", ");
}

export default function AdminShippingPage() {
	const t = useT();
	const { locale } = useLocale();
	const [status, setStatus] = useState<ShippingStatus | null>(null);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setStatus(await GET());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	return (
		<AdminSection value="shipping">
			<Typography variant="h4" component="h1">
				{t("admin.shipping")}
			</Typography>
			{error ? <Alert severity="error">{error}</Alert> : null}
			<Paper variant="outlined" className="market-admin-form">
				<Typography variant="h6" component="h2">
					{t("admin.easyshipTitle")}
				</Typography>
				{loading ? (
					<Typography color="textSecondary">{t("state.loading")}</Typography>
				) : status ? (
					<>
						{status.easyship.configured ? (
							<Alert severity="success">{t("admin.easyshipOn")}</Alert>
						) : (
							<Alert severity="warning">{t("admin.easyshipOff")}</Alert>
						)}
						<div
							className="row"
							style={{ display: "flex", gap: "0.6rem", alignItems: "center" }}
						>
							<Chip
								size="small"
								color={status.easyship.configured ? "success" : "warning"}
							>
								{t("admin.easyshipMode", { mode: status.easyship.mode })}
							</Chip>
							<Chip
								size="small"
								color={status.easyship.tokenConfigured ? "success" : "warning"}
							>
								EASYSHIP_API_TOKEN
							</Chip>
							<Chip
								size="small"
								color={status.easyship.originConfigured ? "success" : "warning"}
							>
								EASYSHIP_ORIGIN_*
							</Chip>
						</div>
						<Typography variant="body2">
							{t("admin.easyshipOrigin")}:{" "}
							{status.easyship.origin
								? formatOrigin(status.easyship.origin)
								: "—"}
						</Typography>
						<Typography variant="body2" color="textSecondary">
							item category: {status.easyship.itemCategory} · output currency:
							USD · weights: g · dimensions: cm
						</Typography>
					</>
				) : null}
			</Paper>
			<Paper variant="outlined" className="market-table-shell">
				<Typography variant="subtitle1" style={{ padding: "0.8rem 1rem 0" }}>
					{t("admin.easyshipLegacy")}
				</Typography>
				{loading ? (
					<Typography color="textSecondary" style={{ padding: "1rem" }}>
						{t("state.loading")}
					</Typography>
				) : (
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>{t("admin.country")}</TableCell>
								<TableCell>{t("admin.region")}</TableCell>
								<TableCell>{t("admin.flatCents")}</TableCell>
								<TableCell>{t("admin.statusLabel")}</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{(status?.legacyRates ?? []).length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={4}
										style={{ color: "var(--market-muted)" }}
									>
										{t("admin.emptyRates")}
									</TableCell>
								</TableRow>
							) : (
								status?.legacyRates.map((rate) => (
									<TableRow key={rate.id}>
										<TableCell>{rate.country}</TableCell>
										<TableCell>{rate.region ?? "—"}</TableCell>
										<TableCell>
											{formatCents(rate.flatCents, "USD", locale)}
										</TableCell>
										<TableCell>
											<Chip
												size="small"
												color={rate.active ? "success" : undefined}
											>
												{rate.active ? t("admin.active") : t("admin.inactive")}
											</Chip>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				)}
			</Paper>
		</AdminSection>
	);
}
