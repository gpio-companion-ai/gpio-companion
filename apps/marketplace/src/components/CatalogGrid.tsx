import Select from "@shpaw415/mui-lite/Select";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import TextField from "@shpaw415/mui-lite/TextField";
import { useMemo, useState } from "react";
import { useLocale, useT } from "../hooks/useLocale.tsx";
import type { PublicCatalogProduct } from "../lib/commerce/catalog-repository.ts";
import EmptyState from "./EmptyState.tsx";
import KitIllustration from "./KitIllustration.tsx";
import ProductCard from "./ProductCard.tsx";

export function mediaUrl(key: string): string {
	return `/api/media?key=${encodeURIComponent(key)}`;
}

export default function CatalogGrid({
	items,
	loading,
}: {
	items: readonly PublicCatalogProduct[];
	loading?: boolean;
}) {
	const t = useT();
	const { locale } = useLocale();
	const [query, setQuery] = useState("");
	const [sort, setSort] = useState<"name" | "price">("name");
	const filtered = useMemo(() => {
		const q = query.trim().toLowerCase();
		const rows = items.filter((item) => {
			if (!q) return true;
			return `${item.nameEn} ${item.nameFr} ${item.sku} ${item.slug}`
				.toLowerCase()
				.includes(q);
		});
		return [...rows].sort((a, b) => {
			if (sort === "price") return a.priceCents - b.priceCents;
			const an = locale === "fr" ? a.nameFr : a.nameEn;
			const bn = locale === "fr" ? b.nameFr : b.nameEn;
			return an.localeCompare(bn);
		});
	}, [items, query, sort, locale]);

	if (loading) {
		return (
			<div className="market-card-grid" aria-busy="true">
				<Skeleton variant="rounded" height={280} />
				<Skeleton variant="rounded" height={280} />
				<Skeleton variant="rounded" height={280} />
			</div>
		);
	}
	return (
		<div>
			<div className="market-catalog-toolbar">
				<TextField
					label={t("catalog.searchLabel")}
					placeholder={t("catalog.search")}
					value={query}
					onChange={(event) => setQuery(event.target.value)}
				/>
				<Select
					name="catalog-sort"
					label={t("catalog.status")}
					aria-label={t("catalog.sortName")}
					value={sort}
					onSelect={(value) => setSort(value === "price" ? "price" : "name")}
				>
					<option value="name">{t("catalog.sortName")}</option>
					<option value="price">{t("catalog.sortPrice")}</option>
				</Select>
			</div>
			{filtered.length === 0 ? (
				<EmptyState
					title={t("catalog.emptyTitle")}
					description={t("catalog.emptyBody")}
				/>
			) : (
				<div className="market-card-grid">
					{filtered.map((item) => {
						const name = locale === "fr" ? item.nameFr : item.nameEn;
						const description =
							locale === "fr" ? item.descriptionFr : item.descriptionEn;
						const image = item.images[0];
						const alt = image
							? locale === "fr"
								? image.altFr
								: image.altEn
							: "";
						return (
							<ProductCard
								key={item.id}
								product={{
									id: item.id,
									slug: item.slug,
									name,
									description,
									price: item.priceCents / 100,
									currency: "USD",
									inStock: item.available > 0,
									badge:
										item.available > 0 && item.available <= 3
											? t("product.lowStock")
											: undefined,
								}}
								illustration={
									image ? (
										<img src={mediaUrl(image.r2Key)} alt={alt} />
									) : (
										<KitIllustration title={name} />
									)
								}
							/>
						);
					})}
				</div>
			)}
		</div>
	);
}
