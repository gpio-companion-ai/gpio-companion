import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useState } from "react";
import { GET } from "../../actions/api/catalog.ts";
import EmptyState from "../../components/EmptyState.tsx";
import QuantityControl from "../../components/QuantityControl.tsx";
import { useCart } from "../../hooks/useCart.tsx";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import type { PublicCatalogProduct } from "../../lib/commerce/catalog-repository.ts";
import { formatCents } from "../../lib/format.ts";

export default function CartPage() {
	const t = useT();
	const { locale } = useLocale();
	const cart = useCart();
	const [catalog, setCatalog] = useState<PublicCatalogProduct[]>([]);
	const [ready, setReady] = useState(false);

	useEffect(() => {
		GET()
			.then(setCatalog)
			.catch(() => setCatalog([]))
			.finally(() => setReady(true));
	}, []);

	if (!ready) return null;
	if (cart.items.length === 0) {
		return (
			<EmptyState
				title={t("cart.emptyTitle")}
				description={t("cart.emptyBody")}
				actionLabel={t("action.browseKits")}
				actionHref="/kits"
			/>
		);
	}

	const rows = cart.items.map((item) => ({
		item,
		product: catalog.find((product) => product.id === item.id) ?? null,
	}));
	const blocked = rows.some(
		(row) => !row.product || row.product.available < row.item.quantity,
	);
	const subtotal = rows.reduce((sum, row) => {
		if (!row.product || row.product.available < row.item.quantity) return sum;
		return sum + row.product.priceCents * row.item.quantity;
	}, 0);

	return (
		<div>
			<Typography variant="h4" component="h1">
				{t("cart.title")}
			</Typography>
			{blocked ? (
				<Alert severity="warning">{t("cart.stockChanged")}</Alert>
			) : null}
			<div className="market-cart-list">
				{rows.map(({ item, product }) => {
					const unavailable = !product || product.available < item.quantity;
					const name = product
						? locale === "fr"
							? product.nameFr
							: product.nameEn
						: item.id;
					return (
						<Paper key={item.id} variant="outlined" className="market-cart-row">
							<div>
								<Typography variant="subtitle1">{name}</Typography>
								<Typography variant="body2" color="textSecondary">
									{product?.sku ?? t("cart.unavailable")}
								</Typography>
								{unavailable ? (
									<Typography color="error">{t("cart.unavailable")}</Typography>
								) : (
									<Typography>
										{formatCents(
											product.priceCents * item.quantity,
											"USD",
											locale,
										)}
									</Typography>
								)}
							</div>
							<QuantityControl
								value={item.quantity}
								label={t("product.quantity")}
								onChange={(next) => cart.update(item.id, next)}
							/>
							<Button variant="text" onClick={() => cart.remove(item.id)}>
								{t("action.remove")}
							</Button>
						</Paper>
					);
				})}
			</div>
			<Paper variant="outlined" className="market-totals">
				<div className="row">
					<span>{t("cart.subtotal")}</span>
					<span>{formatCents(subtotal, "USD", locale)}</span>
				</div>
				<div className="row">
					<span>{t("cart.shipping")}</span>
					<span>{t("cart.shippingLater")}</span>
				</div>
				<Button href="/checkout" variant="contained" disabled={blocked}>
					{t("cart.checkout")}
				</Button>
				<Button variant="text" onClick={() => cart.clear()}>
					{t("action.clearCart")}
				</Button>
			</Paper>
		</div>
	);
}
