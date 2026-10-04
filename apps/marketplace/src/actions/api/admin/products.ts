import { getContext } from "@next/action/context";
import { commerceDb } from "../../../lib/admin-auth.ts";
import {
	createProduct,
	deleteProduct,
	listAdminProducts,
	type ProductDraftInput,
	setProductStatus,
	updateProduct,
} from "../../../lib/commerce/admin-repository.ts";
import type { ProductStatus } from "../../../lib/db/schema.ts";

export async function GET() {
	const ctx = getContext<Env, never, never>(arguments);
	return listAdminProducts(commerceDb(ctx));
}

export async function POST(input: ProductDraftInput) {
	const ctx = getContext<Env, never, never>(arguments);
	return createProduct(commerceDb(ctx), input);
}

export async function PUT(id: string, input: ProductDraftInput) {
	const ctx = getContext<Env, never, never>(arguments);
	return updateProduct(commerceDb(ctx), id, input);
}

export async function PATCH(id: string, status: ProductStatus) {
	const ctx = getContext<Env, never, never>(arguments);
	return setProductStatus(commerceDb(ctx), id, status);
}

export async function DELETE(id: string) {
	const ctx = getContext<Env, never, never>(arguments);
	return deleteProduct(commerceDb(ctx), id);
}
