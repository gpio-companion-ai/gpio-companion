import { GET, PATCH, POST, PUT } from "@api/admin/products";
import {
	DELETE as deleteImage,
	GET as listImages,
	PATCH as updateImage,
	POST as uploadImage,
} from "@api/admin/product-images";
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
import { useCallback, useEffect, useRef, useState } from "react";
import AdminSection from "../../../components/AdminSection.tsx";
import TablePaginationShell, {
	type RowsPerPage,
} from "../../../components/TablePaginationShell.tsx";
import { useLocale, useT } from "../../../hooks/useLocale.tsx";
import { validateProductPublication } from "../../../lib/commerce/validation.ts";
import { formatCents } from "../../../lib/format.ts";

type AdminProduct = Awaited<ReturnType<typeof GET>>[number];
type ProductImage = Awaited<ReturnType<typeof listImages>>[number];

export default function AdminProductsPage() {
	const t = useT();
	const { locale } = useLocale();
	const [rows, setRows] = useState<AdminProduct[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState("");
	const [nameEn, setNameEn] = useState("");
	const [nameFr, setNameFr] = useState("");
	const [descriptionEn, setDescriptionEn] = useState("");
	const [descriptionFr, setDescriptionFr] = useState("");
	const [price, setPrice] = useState("");
	const [weight, setWeight] = useState("");
	const [lengthCm, setLengthCm] = useState("");
	const [widthCm, setWidthCm] = useState("");
	const [heightCm, setHeightCm] = useState("");
	const [statusFilter, setStatusFilter] = useState("all");
	const [saving, setSaving] = useState(false);
	const [images, setImages] = useState<ProductImage[]>([]);
	const [altEn, setAltEn] = useState("");
	const [altFr, setAltFr] = useState("");
	const [uploading, setUploading] = useState(false);
	const fileInputRef = useRef<HTMLInputElement>(null);
	const [page, setPage] = useState(0);
	const [rowsPerPage, setRowsPerPage] = useState<RowsPerPage>(10);

	async function loadImages(productId: string) {
		try {
			setImages(await listImages(productId));
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		}
	}

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const list = await GET();
			setRows(list);
			if (!selectedId && list[0]) select(list[0]);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [selectedId]);

	function select(item: AdminProduct) {
		setSelectedId(item.id);
		setNameEn(item.nameEn);
		setNameFr(item.nameFr);
		setDescriptionEn(item.descriptionEn);
		setDescriptionFr(item.descriptionFr);
		setPrice(item.priceCents === null ? "" : String(item.priceCents));
		setWeight(item.weightGrams === null || item.weightGrams === undefined ? "" : String(item.weightGrams));
		setLengthCm(item.lengthCm === null || item.lengthCm === undefined ? "" : String(item.lengthCm));
		setWidthCm(item.widthCm === null || item.widthCm === undefined ? "" : String(item.widthCm));
		setHeightCm(item.heightCm === null || item.heightCm === undefined ? "" : String(item.heightCm));
		setError(null);
		void loadImages(item.id);
	}

	useEffect(() => {
		void reload();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	const selected = rows.find((item) => item.id === selectedId);

	async function run(action: () => Promise<unknown>) {
		setSaving(true);
		setError(null);
		try {
			await action();
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setSaving(false);
		}
	}

	function draftInput() {
		if (!selected) throw new Error("No product selected");
		const priceCents = price.trim() === "" ? null : Number.parseInt(price, 10);
		const parseOptional = (value: string) =>
			value.trim() === "" ? null : Number.parseInt(value, 10);
		return {
			slug: selected.slug,
			sku: selected.sku,
			nameEn: nameEn.trim(),
			nameFr: nameFr.trim(),
			descriptionEn: descriptionEn.trim(),
			descriptionFr: descriptionFr.trim(),
			priceCents,
			weightGrams: parseOptional(weight),
			lengthCm: parseOptional(lengthCm),
			widthCm: parseOptional(widthCm),
			heightCm: parseOptional(heightCm),
		};
	}

	const filtered = rows.filter((item) =>
		statusFilter === "all" ? true : item.status === statusFilter,
	);
	const visible = filtered.slice(page * rowsPerPage, page * rowsPerPage + rowsPerPage);
	const priceNumber = Number.parseInt(price, 10);
	const weightNumber = weight.trim() === "" ? null : Number.parseInt(weight, 10);
	const gates = selected
		? validateProductPublication({
				slug: selected.slug,
				sku: selected.sku,
				nameEn,
				nameFr,
				descriptionEn,
				descriptionFr,
				priceCents: price.trim() === "" ? null : priceNumber,
				weightGrams: weightNumber,
				dimensionsConfigured: Boolean(
					Number.parseInt(lengthCm, 10) > 0 &&
						Number.parseInt(widthCm, 10) > 0 &&
						Number.parseInt(heightCm, 10) > 0,
				),
				imageCount: images.length,
				inventoryConfigured: true,
			})
		: [];

	return (
		<AdminSection value="products">
			<Typography variant="h4" component="h1">
				{t("admin.products")}
			</Typography>
			{error ? <Alert severity="error">{error}</Alert> : null}
			<Select
				name="product-status"
				label={t("admin.statusLabel")}
				value={statusFilter}
				onSelect={(value) => {
					setStatusFilter(value);
					setPage(0);
				}}
			>
				<option value="all">{t("admin.statusAll")}</option>
				<option value="draft">{t("admin.statusDraft")}</option>
				<option value="published">{t("admin.statusPublished")}</option>
				<option value="archived">{t("admin.statusArchived")}</option>
			</Select>
			<Paper variant="outlined" className="market-admin-form">
				<Typography variant="h6" component="h2">
					{t("admin.productEditor")} — {selected?.sku ?? "—"}
				</Typography>
				<div className="market-form-row">
					<TextField
						label={t("admin.nameEn")}
						value={nameEn}
						onChange={(event) => setNameEn(event.target.value)}
					/>
					<TextField
						label={t("admin.nameFr")}
						value={nameFr}
						onChange={(event) => setNameFr(event.target.value)}
					/>
				</div>
				<TextField
					label={t("admin.descriptionEn")}
					multiline
					value={descriptionEn}
					onChange={(event) => setDescriptionEn(event.target.value)}
				/>
				<TextField
					label={t("admin.descriptionFr")}
					multiline
					value={descriptionFr}
					onChange={(event) => setDescriptionFr(event.target.value)}
				/>
				<div className="market-form-row">
					<TextField
						label={t("admin.priceCents")}
						placeholder="empty — admin must set"
						value={price}
						onChange={(event) => setPrice(event.target.value)}
						helpText={
							Number.isSafeInteger(priceNumber)
								? t("admin.usdPreview", {
										price: formatCents(priceNumber, "USD", locale),
									})
								: undefined
						}
					/>
					<TextField
						label={t("admin.skuSlug")}
						value={selected ? `${selected.sku} / ${selected.slug}` : ""}
						disabled
					/>
				</div>
				<div className="market-form-row">
					<TextField
						label={t("admin.weightGrams")}
						placeholder="850"
						value={weight}
						onChange={(event) => setWeight(event.target.value)}
					/>
					<TextField
						label="L (cm)"
						placeholder="30"
						value={lengthCm}
						onChange={(event) => setLengthCm(event.target.value)}
					/>
					<TextField
						label="W (cm)"
						placeholder="20"
						value={widthCm}
						onChange={(event) => setWidthCm(event.target.value)}
					/>
					<TextField
						label="H (cm)"
						placeholder="10"
						value={heightCm}
						onChange={(event) => setHeightCm(event.target.value)}
					/>
				</div>
				<Typography variant="subtitle2">
					{t("admin.images")} ({images.length})
				</Typography>
				{images.length === 0 ? (
					<Typography variant="body2" color="textSecondary">
						{t("admin.noImages")}
					</Typography>
				) : (
					<Table size="small">
						<TableHead>
							<TableRow>
								<TableCell />
								<TableCell>alt EN / FR</TableCell>
								<TableCell>order</TableCell>
								<TableCell />
							</TableRow>
						</TableHead>
						<TableBody>
							{images.map((image) => (
								<TableRow key={image.id}>
									<TableCell>
										<img
											src={`/api/media?key=${encodeURIComponent(image.r2Key)}`}
											alt={image.altEn}
											width={72}
											height={44}
											style={{ objectFit: "cover", borderRadius: 8 }}
										/>
									</TableCell>
									<TableCell>
										{image.altEn} / {image.altFr}
									</TableCell>
									<TableCell>{image.sortOrder}</TableCell>
									<TableCell>
										<Button
											variant="text"
											size="small"
											disabled={uploading}
											onClick={() =>
												run(async () => {
													await deleteImage(image.id);
													await loadImages(selectedId);
												})
											}
										>
										{t("admin.delete")}
									</Button>
									<Button
										variant="text"
										size="small"
										onClick={() =>
											run(async () => {
												await updateImage(image.id, {
													sortOrder: Math.max(0, image.sortOrder - 1),
													altEn: image.altEn,
													altFr: image.altFr,
												});
												await loadImages(selectedId);
											})
										}
									>
										{t("admin.moveUp")}
									</Button>
									<Button
										variant="text"
										size="small"
										onClick={() =>
											run(async () => {
												await updateImage(image.id, {
													sortOrder: image.sortOrder + 1,
													altEn: image.altEn,
													altFr: image.altFr,
												});
												await loadImages(selectedId);
											})
										}
									>
										{t("admin.moveDown")}
									</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				)}
				<div className="market-form-row">
					<TextField
						label="alt EN"
						value={altEn}
						onChange={(event) => setAltEn(event.target.value)}
					/>
					<TextField
						label="alt FR"
						value={altFr}
						onChange={(event) => setAltFr(event.target.value)}
					/>
				</div>
				<div className="bar">
					<input
						ref={fileInputRef}
						type="file"
						accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
						hidden
						disabled={!selected || uploading}
						onChange={(event) => {
							const file = event.target.files?.[0];
							if (!file || !selected) return;
							event.target.value = "";
							setUploading(true);
							setError(null);
							uploadImage(selected.id, file, altEn.trim(), altFr.trim())
								.then(() => loadImages(selected.id))
								.then(() => {
									setAltEn("");
									setAltFr("");
								})
								.catch((err: unknown) =>
									setError(err instanceof Error ? err.message : String(err)),
								)
								.finally(() => setUploading(false));
						}}
					/>
					<Button
						variant="outlined"
						disabled={!selected || uploading}
						onClick={() => fileInputRef.current?.click()}
					>
						{uploading ? t("state.loading") : t("admin.uploadImage")}
					</Button>
					<Typography variant="body2" color="textSecondary">
						JPEG / PNG / WebP / AVIF / GIF · ≤ 5 MB
					</Typography>
				</div>
				<div className="bar">
					<Button
						variant="contained"
						disabled={!selected || saving}
						onClick={() =>
							run(() => PUT(selectedId, draftInput()).then(() => undefined))
						}
					>
						{t("admin.saveDraft")}
					</Button>
					<Button
						variant="outlined"
						disabled={!selected || saving}
						onClick={() => run(() => PATCH(selectedId, "published"))}
					>
						{t("admin.publish")}
					</Button>
					<Button
						variant="text"
						disabled={!selected || saving}
						onClick={() => run(() => PATCH(selectedId, "archived"))}
					>
						{t("admin.archive")}
					</Button>
				</div>
				<Typography variant="subtitle2">{t("admin.gates")}</Typography>
				{gates.length === 0 ? (
					<Typography color="textSecondary">{t("admin.publish")}</Typography>
				) : (
					gates.map((gate) => (
						<Typography key={gate} color="error">
							{gate}
						</Typography>
					))
				)}
			</Paper>
			<Paper variant="outlined" className="market-admin-form">
				<Typography variant="h6" component="h2">
					{t("admin.create")}
				</Typography>
				<CreateProductForm
					disabled={saving}
					onCreated={(item) => {
						void reload().then(() => select(item as AdminProduct));
					}}
					onError={setError}
				/>
			</Paper>
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
								<TableCell>SKU</TableCell>
								<TableCell>{t("catalog.kit")}</TableCell>
								<TableCell>{t("admin.statusLabel")}</TableCell>
								<TableCell>{t("catalog.price")}</TableCell>
								<TableCell />
							</TableRow>
						</TableHead>
						<TableBody>
							{visible.map((item) => (
								<TableRow key={item.id} selected={item.id === selectedId}>
									<TableCell>{item.sku}</TableCell>
									<TableCell>{item.nameEn}</TableCell>
									<TableCell>
										<Chip
											size="small"
											color={item.status === "published" ? "success" : "warning"}
										>
											{item.status}
										</Chip>
									</TableCell>
									<TableCell>
										{item.priceCents === null
											? t("catalog.tbd")
											: formatCents(item.priceCents, "USD", locale)}
									</TableCell>
									<TableCell>
										<Button
											variant="text"
											size="small"
											onClick={() => select(item)}
										>
											{t("admin.edit")}
										</Button>
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
				</TablePaginationShell>
			)}
		</AdminSection>
	);
}

function CreateProductForm({
	disabled,
	onCreated,
	onError,
}: {
	disabled: boolean;
	onCreated: (item: unknown) => void;
	onError: (message: string | null) => void;
}) {
	const t = useT();
	const [slug, setSlug] = useState("");
	const [sku, setSku] = useState("");
	const [nameEn, setNameEn] = useState("");
	const [nameFr, setNameFr] = useState("");
	const [descriptionEn, setDescriptionEn] = useState("");
	const [descriptionFr, setDescriptionFr] = useState("");
	const [busy, setBusy] = useState(false);

	async function create() {
		setBusy(true);
		onError(null);
		try {
			const item = await POST({
				slug: slug.trim(),
				sku: sku.trim(),
				nameEn: nameEn.trim(),
				nameFr: nameFr.trim(),
				descriptionEn: descriptionEn.trim(),
				descriptionFr: descriptionFr.trim(),
				priceCents: null,
			});
			setSlug("");
			setSku("");
			setNameEn("");
			setNameFr("");
			onCreated(item);
		} catch (err) {
			onError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<div>
			<div className="market-form-row">
				<TextField
					label={t("admin.slug")}
					placeholder="my-kit"
					value={slug}
					onChange={(event) => setSlug(event.target.value)}
				/>
				<TextField
					label={t("admin.sku")}
					placeholder="GPIO-MY-KIT"
					value={sku}
					onChange={(event) => setSku(event.target.value)}
				/>
			</div>
			<div className="market-form-row">
				<TextField
					label={t("admin.nameEn")}
					value={nameEn}
					onChange={(event) => setNameEn(event.target.value)}
				/>
				<TextField
					label={t("admin.nameFr")}
					value={nameFr}
					onChange={(event) => setNameFr(event.target.value)}
				/>
			</div>
			<TextField
				label={t("admin.descriptionEn")}
				multiline
				value={descriptionEn}
				onChange={(event) => setDescriptionEn(event.target.value)}
			/>
			<TextField
				label={t("admin.descriptionFr")}
				multiline
				value={descriptionFr}
				onChange={(event) => setDescriptionFr(event.target.value)}
			/>
			<div className="bar">
					<Button variant="contained" disabled={disabled || busy} onClick={create}>
					{t("admin.createDraft")}
				</Button>
			</div>
		</div>
	);
}
