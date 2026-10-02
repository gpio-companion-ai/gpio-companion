import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Table, { TableBody, TableCell, TableHead, TableRow } from "@shpaw415/mui-lite/Table";
import Typography from "@shpaw415/mui-lite/Typography";
import { ThrowNotFound } from "frame-master-plugin-apply-react/utils";
import { useEffect, useState } from "react";
import { GET } from "../../actions/api/order.ts";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import { usePath } from "../../hooks/usePath.ts";
import { formatCents } from "../../lib/format.ts";

function idFromPath(pathname: string): string {
	const segments = pathname.split("/").filter(Boolean);
	return segments[segments.length - 1] ?? "";
}

export default function OrderDetailPage() {
	const t = useT();
	const { locale } = useLocale();
	const id = idFromPath(usePath() ?? "");
	const [order, setOrder] = useState<Awaited<ReturnType<typeof GET>> | undefined>(undefined);

	useEffect(() => {
		if (!id) return;
		GET(id)
			.then(setOrder)
			.catch(() => setOrder(null));
	}, [id]);

	if (order === undefined) return <Skeleton variant="rounded" height={240} />;
	if (!order || Array.isArray(order)) {
		ThrowNotFound();
		return null;
	}
	return (
		<div>
			<Typography variant="h4" component="h1">
				{t("orders.detailTitle", { id: order.orderNumber })}
			</Typography>
			<Typography color="textSecondary">{t("orders.detailNote")}</Typography>
			<Paper variant="outlined" className="market-totals">
				<div className="row">
					<span>{t("orders.payment")}</span>
					<Chip size="small">{order.paymentStatus}</Chip>
				</div>
				<div className="row">
					<span>{t("orders.fulfillment")}</span>
					<Chip size="small">{order.fulfillmentStatus}</Chip>
				</div>
				<div className="row">
					<span>{t("orders.carrier")}</span>
					<span>
						{order.carrier ??
							(order.shippingCourierName
								? `${order.shippingCourierName}${
										order.shippingMinDays !== null || order.shippingMaxDays !== null
											? ` (${order.shippingMinDays ?? "—"}–${order.shippingMaxDays ?? "—"} ${locale === "fr" ? "jours ouvrables" : "working days"})`
											: ""
									}`
								: t("catalog.tbd"))}
					</span>
				</div>
				<div className="row">
					<span>{t("orders.tracking")}</span>
					<span>{order.trackingNumber ?? t("catalog.tbd")}</span>
				</div>
				<div className="row">
					<span>{t("orders.address")}</span>
					<span>
						{order.shippingName}, {order.shippingLine1}, {order.shippingCity}{" "}
						{order.shippingPostalCode} {order.shippingCountry}
					</span>
				</div>
				<div className="row grand">
					<span>{t("orders.total")}</span>
					<span>{formatCents(order.totalCents, order.currency, locale)}</span>
				</div>
			</Paper>
			<Paper variant="outlined" className="market-table-shell">
				<Table size="small">
					<TableHead>
						<TableRow>
							<TableCell>{t("catalog.kit")}</TableCell>
							<TableCell>{t("catalog.quantity")}</TableCell>
							<TableCell>{t("catalog.price")}</TableCell>
						</TableRow>
					</TableHead>
					<TableBody>
						{order.items.map((item) => (
							<TableRow key={item.id}>
								<TableCell>{locale === "fr" ? item.nameFr : item.nameEn}</TableCell>
								<TableCell>{item.quantity}</TableCell>
								<TableCell>{formatCents(item.lineTotalCents, "USD", locale)}</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</Paper>
			<Button href="/orders" variant="text">
				{t("orders.backToOrders")}
			</Button>
		</div>
	);
}
