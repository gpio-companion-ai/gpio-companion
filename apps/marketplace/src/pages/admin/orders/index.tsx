import { GET, PATCH } from "@api/admin/orders";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Table, {
	TableBody,
	TableCell,
	TableHead,
	TableRow,
} from "@shpaw415/mui-lite/Table";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useState } from "react";
import AdminSection from "../../../components/AdminSection.tsx";
import TablePaginationShell, {
	type RowsPerPage,
} from "../../../components/TablePaginationShell.tsx";
import { useLocale, useT } from "../../../hooks/useLocale.tsx";
import type { FulfillmentStatus } from "../../../lib/db/schema.ts";
import { formatCents } from "../../../lib/format.ts";

type AdminOrder = Awaited<ReturnType<typeof GET>>[number];

export default function AdminOrdersPage() {
	const t = useT();
	const { locale } = useLocale();
	const [rows, setRows] = useState<AdminOrder[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [filter, setFilter] = useState("");
	const [payment, setPayment] = useState("all");
	const [detailId, setDetailId] = useState("");
	const [carrier, setCarrier] = useState("");
	const [tracking, setTracking] = useState("");
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState<RowsPerPage>(10);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			setRows(await GET());
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void reload();
	}, [reload]);

	async function transition(id: string, fulfillmentStatus: FulfillmentStatus) {
		setError(null);
		try {
			await PATCH(id, { fulfillmentStatus });
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	const q = filter.trim().toLowerCase();
	const filtered = rows.filter((order) => {
		if (!q) return true;
		if (payment !== "all" && order.paymentStatus !== payment) return false;
		return `${order.id} ${order.orderNumber} ${order.email}`
			.toLowerCase()
			.includes(q);
	});
	const visible = filtered.slice(
		page * rowsPerPage,
		page * rowsPerPage + rowsPerPage,
	);

	return (
		<AdminSection value="orders">
			<Typography variant="h4" component="h1">
				{t("admin.orders")}
			</Typography>
			{error ? <Alert severity="error">{error}</Alert> : null}
			<div className="market-form-row">
				<TextField
					label={t("admin.filterPlaceholder")}
					value={filter}
					onChange={(event) => {
						setFilter(event.target.value);
						setPage(0);
					}}
				/>
				<Select
					name="payment-filter"
					label={t("admin.paymentFilter")}
					value={payment}
					onSelect={(value) => {
						setPayment(value);
						setPage(0);
					}}
				>
					<option value="all">{t("admin.allStates")}</option>
					<option value="pending">pending</option>
					<option value="captured">captured</option>
					<option value="failed">failed</option>
					<option value="refunded">refunded</option>
				</Select>
			</div>
			{loading ? (
				<Typography color="textSecondary">{t("state.loading")}</Typography>
			) : (
				<TablePaginationShell
					count={filtered.length}
					page={page}
					rowsPerPage={rowsPerPage}
					onPageChange={setPage}
					onRowsPerPageChange={(next) => {
						setRowsPerPage(next);
						setPage(0);
					}}
				>
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>ORDER</TableCell>
								<TableCell>PAYPAL</TableCell>
								<TableCell>TOTAL</TableCell>
								<TableCell>FULFILLMENT</TableCell>
								<TableCell />
							</TableRow>
						</TableHead>
						<TableBody>
							{visible.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										style={{ color: "var(--market-muted)" }}
									>
										{t("admin.emptyOrders")}
									</TableCell>
								</TableRow>
							) : (
								visible.map((order) => (
									<TableRow key={order.id}>
										<TableCell>
											{order.orderNumber}
											<br />
											<span style={{ color: "var(--market-muted)" }}>
												{order.email}
											</span>
										</TableCell>
										<TableCell>{order.paymentStatus}</TableCell>
										<TableCell>
											{formatCents(order.totalCents, order.currency, locale)}
										</TableCell>
										<TableCell>
											<Chip size="small">{order.fulfillmentStatus}</Chip>
										</TableCell>
										<TableCell>
											{order.fulfillmentStatus === "unfulfilled" ? (
												<Button
													variant="text"
													size="small"
													onClick={() => transition(order.id, "processing")}
												>
													{t("admin.processing")}
												</Button>
											) : order.fulfillmentStatus === "processing" ? (
												<Button
													variant="text"
													size="small"
													onClick={() => transition(order.id, "shipped")}
												>
													{t("admin.shipped")}
												</Button>
											) : null}
											<Button
												variant="text"
												size="small"
												onClick={() => {
													setDetailId(order.id);
													setCarrier(order.carrier ?? "");
													setTracking(order.trackingNumber ?? "");
												}}
											>
												{t("admin.orderDetail")}
											</Button>
										</TableCell>
									</TableRow>
								))
							)}
						</TableBody>
					</Table>
				</TablePaginationShell>
			)}
			{detailId ? (
				<Paper variant="outlined" className="market-admin-form">
					<Typography variant="h6">{t("admin.orderDetail")}</Typography>
					<TextField
						label={t("admin.carrier")}
						value={carrier}
						onChange={(event) => setCarrier(event.target.value)}
					/>
					<TextField
						label={t("admin.trackingNumber")}
						value={tracking}
						onChange={(event) => setTracking(event.target.value)}
					/>
					<Button
						variant="contained"
						onClick={() =>
							void PATCH(detailId, {
								carrier: carrier.trim() || null,
								trackingNumber: tracking.trim() || null,
								...(tracking.trim()
									? { fulfillmentStatus: "shipped" as const }
									: {}),
							}).then(() => reload())
						}
					>
						{t("admin.saveTracking")}
					</Button>
				</Paper>
			) : null}
		</AdminSection>
	);
}
