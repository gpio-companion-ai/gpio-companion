import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Typography from "@shpaw415/mui-lite/Typography";
import { ThrowNotFound } from "frame-master-plugin-apply-react/utils";
import { useEffect, useState } from "react";
import { GET } from "../../actions/api/kits.ts";
import { mediaUrl } from "../../components/CatalogGrid.tsx";
import KitIllustration from "../../components/KitIllustration.tsx";
import Price from "../../components/Price.tsx";
import QuantityControl from "../../components/QuantityControl.tsx";
import { useCart } from "../../hooks/useCart.tsx";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import { usePath } from "../../hooks/usePath.ts";
import type { PublicCatalogProduct } from "../../lib/commerce/catalog-repository.ts";

function slugFromPath(pathname: string): string {
	const segments = pathname.split("/").filter(Boolean);
	return decodeURIComponent(segments[segments.length - 1] ?? "");
}

export default function KitDetailPage() {
	const t = useT();
	const { locale } = useLocale();
	const cart = useCart();
	const pathname = usePath() ?? "";
	const slug = slugFromPath(pathname);
	const [item, setItem] = useState<PublicCatalogProduct | null | undefined>(
		undefined,
	);
	const [qty, setQty] = useState(1);
	const [added, setAdded] = useState(false);

	useEffect(() => {
		if (!slug) return;
		setItem(undefined);
		GET(slug)
			.then((row) => setItem(row))
			.catch(() => setItem(null));
	}, [slug]);

	if (item === undefined) {
		return <Skeleton variant="rounded" height={360} />;
	}
	if (!item) {
		ThrowNotFound();
		return null;
	}
	const name = locale === "fr" ? item.nameFr : item.nameEn;
	const description = locale === "fr" ? item.descriptionFr : item.descriptionEn;
	const image = item.images[0];
	const inStock = item.available > 0;
	return (
		<div className="market-kit-detail">
			<div className="market-kit-visual">
				{image ? (
					<img
						src={mediaUrl(image.r2Key)}
						alt={locale === "fr" ? image.altFr : image.altEn}
					/>
				) : (
					<KitIllustration title={name} />
				)}
			</div>
			<Paper variant="outlined" className="market-kit-copy">
				<Typography variant="overline">{item.sku}</Typography>
				<Typography variant="h3" component="h1">
					{name}
				</Typography>
				<Chip size="small" color={inStock ? "success" : "warning"}>
					{inStock
						? item.available <= 3
							? t("product.lowStock")
							: t("product.inStock")
						: t("product.outOfStock")}
				</Chip>
				<Typography color="textSecondary">{description}</Typography>
				<Price amount={item.priceCents / 100} currency="USD" />
				<QuantityControl
					value={qty}
					label={t("product.quantity")}
					onChange={setQty}
				/>
				<Button
					variant="contained"
					disabled={!inStock}
					onClick={() => {
						cart.add(item.id, qty);
						setAdded(true);
					}}
				>
					{added ? t("nav.cart") : t("action.addToCart")}
				</Button>
				{added ? (
					<Button href="/cart" variant="text">
						{t("cart.title")}
					</Button>
				) : null}
			</Paper>
		</div>
	);
}
