import { getContext } from "@next/action/context";
import { commerceDb } from "../../../lib/admin-auth.ts";
import {
	createPolicy,
	deletePolicy,
	listPolicies,
	type PolicyInput,
	setPolicyStatus,
	updatePolicy,
} from "../../../lib/commerce/admin-repository.ts";
import type { PolicyStatus } from "../../../lib/db/schema.ts";

export async function GET() {
	const ctx = getContext<Env, never, never>(arguments);
	return listPolicies(commerceDb(ctx));
}

export async function POST(input: PolicyInput) {
	const ctx = getContext<Env, never, never>(arguments);
	return createPolicy(commerceDb(ctx), input);
}

export async function PUT(id: string, input: PolicyInput) {
	const ctx = getContext<Env, never, never>(arguments);
	return updatePolicy(commerceDb(ctx), id, input);
}

export async function PATCH(id: string, status: PolicyStatus) {
	const ctx = getContext<Env, never, never>(arguments);
	return setPolicyStatus(commerceDb(ctx), id, status);
}

export async function DELETE(id: string) {
	const ctx = getContext<Env, never, never>(arguments);
	return deletePolicy(commerceDb(ctx), id);
}
