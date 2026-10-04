import { GET, POST, PUT } from "@api/admin/inventory";
import { GET as listProducts } from "@api/admin/products";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
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
import { useLocale, useT } from "../../../hooks/useLocale.tsx";
import { formatDate } from "../../../lib/format.ts";

type InventoryPayload = Awaited<ReturnType<typeof GET>>;
type Adjustment = InventoryPayload["adjustments"][number];
type Level = InventoryPayload["levels"][number];
type Product = Awaited<ReturnType<typeof listProducts>>[number];

export default function AdminInventoryPage() {
	const t = useT();
	const { locale } = useLocale();
	const [products, setProducts] = useState<Product[]>([]);
	const [levels, setLevels] = useState<Level[]>([]);
	const [history, setHistory] = useState<Adjustment[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [productId, setProductId] = useState("");
	const [onHand, setOnHand] = useState("");
	const [delta, setDelta] = useState("");
	const [reason, setReason] = useState("");
	const [busy, setBusy] = useState(false);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const [list, stock] = await Promise.all([listProducts(), GET()]);
			setProducts(list);
			setLevels(stock.levels);
			setHistory(stock.adjustments);
			if (!productId && list[0]) setProductId(list[0].id);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [productId]);

	useEffect(() => {
		void reload();
	}, [reload]);

	async function run(action: () => Promise<unknown>) {
		setBusy(true);
		setError(null);
		try {
			await action();
			const stock = await GET();
			setLevels(stock.levels);
			setHistory(stock.adjustments);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	const level = levels.find((row) => row.productId === productId);
	const selectedHistory = productId
		? history.filter((row) => row.productId === productId)
		: history;

	return (
		<AdminSection value="inventory">
			<Typography variant="h4" component="h1">
				{t("admin.inventory")}
			</Typography>
			{error ? <Alert severity="error">{error}</Alert> : null}
			{level ? (
				<Typography color="textSecondary">
					{t("admin.onHand")} {level.onHand} · {t("admin.reserved")}{" "}
					{level.reserved} · {t("admin.available")}{" "}
					{Math.max(0, level.onHand - level.reserved)}
				</Typography>
			) : null}
			<Paper variant="outlined" className="market-admin-form">
				<div className="market-form-row">
					<Select
						name="inventory-product"
						label={t("catalog.kit")}
						value={productId}
						onSelect={(value) => setProductId(value)}
					>
						{products.map((item) => (
							<option key={item.id} value={item.id}>
								{item.sku}
							</option>
						))}
					</Select>
					<TextField
						label={t("admin.onHand")}
						placeholder="100"
						value={onHand}
						onChange={(event) => setOnHand(event.target.value)}
					/>
				</div>
				<div className="bar">
					<Button
						variant="outlined"
						disabled={busy || !productId}
						onClick={() => {
							const parsed = Number.parseInt(onHand.trim(), 10);
							if (!Number.isSafeInteger(parsed) || parsed < 0) {
								setError("On-hand must be a non-negative integer");
								return;
							}
							void run(() => POST(productId, parsed)).then(() => setOnHand(""));
						}}
					>
						{t("admin.configureStock")}
					</Button>
				</div>
				<TextField
					label={t("admin.delta")}
					placeholder="+10 / -2"
					value={delta}
					onChange={(event) => setDelta(event.target.value)}
				/>
				<TextField
					label={t("admin.reason")}
					value={reason}
					onChange={(event) => setReason(event.target.value)}
				/>
				<div className="bar">
					<Button
						variant="contained"
						disabled={busy || !productId}
						onClick={() => {
							const parsed = Number.parseInt(delta.trim(), 10);
							if (!Number.isSafeInteger(parsed) || parsed === 0) {
								setError("Adjustment must be a non-zero integer");
								return;
							}
							if (!reason.trim()) {
								setError("Reason is required");
								return;
							}
							void run(() => PUT(productId, parsed, reason.trim())).then(() => {
								setDelta("");
								setReason("");
							});
						}}
					>
						{t("admin.adjust")}
					</Button>
				</div>
			</Paper>
			<Paper variant="outlined" className="market-table-shell">
				<Typography
					variant="h6"
					component="h2"
					style={{ padding: "1rem 1rem 0" }}
				>
					{t("admin.history")}
				</Typography>
				{loading ? (
					<Typography color="textSecondary" style={{ padding: "0 1rem 1rem" }}>
						{t("state.loading")}
					</Typography>
				) : (
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell>WHEN</TableCell>
								<TableCell>SKU</TableCell>
								<TableCell>DELTA</TableCell>
								<TableCell>{t("admin.reason")}</TableCell>
								<TableCell>BY</TableCell>
							</TableRow>
						</TableHead>
						<TableBody>
							{selectedHistory.length === 0 ? (
								<TableRow>
									<TableCell
										colSpan={5}
										style={{ color: "var(--market-muted)" }}
									>
										{t("admin.emptyHistory")}
									</TableCell>
								</TableRow>
							) : (
								selectedHistory.map((row) => (
									<TableRow key={row.id}>
										<TableCell>
											{formatDate(row.createdAt * 1000, locale)}
										</TableCell>
										<TableCell>{row.productId}</TableCell>
										<TableCell>{row.delta}</TableCell>
										<TableCell>{row.reason}</TableCell>
										<TableCell>{row.actorId ?? "—"}</TableCell>
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
