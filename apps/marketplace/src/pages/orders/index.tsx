import Button from "@shpaw415/mui-lite/Button";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Table, {
	TableBody,
	TableCell,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useState } from "react";
import { GET } from "../../actions/api/orders.ts";
import EmptyState from "../../components/EmptyState.tsx";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import { useSession } from "../../hooks/useSession.tsx";
import { formatCents, formatDate } from "../../lib/format.ts";

type OrderRow = Awaited<ReturnType<typeof GET>>[number];

export default function OrdersPage() {
	const t = useT();
	const { locale } = useLocale();
	const { session, ready } = useSession();
	const [orders, setOrders] = useState<OrderRow[]>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!ready) return;
		if (!session?.id) {
			setLoading(false);
			return;
		}
		GET()
			.then(setOrders)
			.catch(() => setOrders([]))
			.finally(() => setLoading(false));
	}, [ready, session?.id]);

	if (!ready || loading) return <Skeleton variant="rounded" height={180} />;
	if (!session?.id) {
		return (
			<EmptyState
				title={t("orders.signInTitle")}
				description={t("orders.signInBody")}
				actionLabel={t("nav.signIn")}
				actionHref="/login"
			/>
		);
	}
	if (orders.length === 0) {
		return (
			<EmptyState
				title={t("orders.emptyTitle")}
				description={t("orders.emptyBody")}
				actionLabel={t("action.browseKits")}
				actionHref="/kits"
			/>
		);
	}
	return (
		<div>
			<Typography variant="h4" component="h1">
				{t("orders.title")}
			</Typography>
			<div className="market-table-shell">
				<Table size="small">
					<TableHead>
						<TableRow>
							<TableCell>{t("orders.orderId")}</TableCell>
							<TableCell>{t("orders.placed")}</TableCell>
							<TableCell>{t("orders.total")}</TableCell>
							<TableCell>{t("orders.payment")}</TableCell>
							<TableCell>{t("orders.fulfillment")}</TableCell>
							<TableCell>{t("orders.tracking")}</TableCell>
							<TableCell />
						</TableRow>
					</TableHead>
					<TableBody>
						{orders.map((order) => (
							<TableRow key={order.id}>
								<TableCell>{order.orderNumber}</TableCell>
								<TableCell>
									{formatDate(order.createdAt * 1000, locale)}
								</TableCell>
								<TableCell>
									{formatCents(order.totalCents, order.currency, locale)}
								</TableCell>
								<TableCell>{order.paymentStatus}</TableCell>
								<TableCell>{order.fulfillmentStatus}</TableCell>
								<TableCell>
									{order.trackingNumber ?? t("catalog.tbd")}
								</TableCell>
								<TableCell>
									<Button
										href={`/orders/${order.id}`}
										variant="text"
										size="small"
									>
										{t("action.viewKit")}
									</Button>
								</TableCell>
							</TableRow>
						))}
					</TableBody>
				</Table>
			</div>
		</div>
	);
}
