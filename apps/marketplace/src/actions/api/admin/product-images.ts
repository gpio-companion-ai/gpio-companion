import { getContext } from "@next/action/context";
import { commerceDb, requireAdmin } from "../../../lib/admin-auth.ts";
import {
	addProductImage,
	deleteProductImage,
	getProductImage,
	listProductImages,
	updateProductImage,
} from "../../../lib/commerce/admin-repository.ts";

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const MIME_TO_EXT: Record<string, string> = {
	"image/jpeg": "jpg",
	"image/png": "png",
	"image/webp": "webp",
	"image/avif": "avif",
	"image/gif": "gif",
};

function mediaBucket(ctx: { env: Env }): R2Bucket {
	const bucket = (ctx.env as Env).MARKETPLACE_MEDIA;
	if (!bucket) throw new Error("MARKETPLACE_MEDIA binding is missing");
	return bucket;
}

function validateImageFile(file: File): string {
	const ext = MIME_TO_EXT[file.type];
	if (!ext) {
		throw new Error(
			"Unsupported image type. Use JPEG, PNG, WebP, AVIF, or GIF.",
		);
	}
	const nameExt = file.name.split(".").pop()?.toLowerCase() ?? "";
	if (
		nameExt !== ext &&
		!(ext === "jpg" && (nameExt === "jpg" || nameExt === "jpeg"))
	) {
		throw new Error("File extension does not match image content type");
	}
	if (file.size <= 0 || file.size > MAX_IMAGE_BYTES) {
		throw new Error("Image must be non-empty and at most 5 MB");
	}
	return ext;
}

export async function GET(productId: string) {
	const ctx = getContext<Env, never, never>(arguments);
	await requireAdmin(ctx);
	return listProductImages(commerceDb(ctx), productId);
}

export async function POST(
	productId: string,
	file: File,
	altEn: string,
	altFr: string,
) {
	const ctx = getContext<Env, never, never>(arguments);
	await requireAdmin(ctx);
	if (!altEn.trim() || !altFr.trim()) {
		throw new Error("Bilingual alt text is required");
	}
	const ext = validateImageFile(file);
	const db = commerceDb(ctx);
	const existing = await listProductImages(db, productId);
	const key = `products/${productId}/${crypto.randomUUID()}.${ext}`;
	await mediaBucket(ctx).put(key, await file.arrayBuffer(), {
		httpMetadata: { contentType: file.type },
	});
	return addProductImage(db, productId, {
		r2Key: key,
		altEn: altEn.trim(),
		altFr: altFr.trim(),
		sortOrder: existing.length,
	});
}

export async function PATCH(
	id: string,
	input: { sortOrder: number; altEn: string; altFr: string },
) {
	const ctx = getContext<Env, never, never>(arguments);
	await requireAdmin(ctx);
	const db = commerceDb(ctx);
	const current = await getProductImage(db, id);
	if (!current) return null;
	return updateProductImage(db, id, {
		r2Key: current.r2Key,
		altEn: input.altEn,
		altFr: input.altFr,
		sortOrder: input.sortOrder,
	});
}

export async function DELETE(id: string) {
	const ctx = getContext<Env, never, never>(arguments);
	await requireAdmin(ctx);
	const db = commerceDb(ctx);
	const current = await getProductImage(db, id);
	if (!current) return false;
	await mediaBucket(ctx).delete(current.r2Key);
	return deleteProductImage(db, id);
}
