import { navigate } from "frame-master-plugin-apply-react/utils";
import type { ReactNode } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { useSession } from "../hooks/useSession.tsx";
import AdminGate from "./AdminGate.tsx";
import AdminTabs from "./AdminTabs.tsx";

export type AdminSectionValue =
	| "overview"
	| "products"
	| "inventory"
	| "orders"
	| "shipping"
	| "policies";

export default function AdminSection({
	value,
	children,
}: {
	value: AdminSectionValue;
	children: ReactNode;
}) {
	const t = useT();
	const { session, ready } = useSession();
	const items = [
		{ value: "products", label: t("admin.products") },
		{ value: "inventory", label: t("admin.inventory") },
		{ value: "orders", label: t("admin.orders") },
		{ value: "shipping", label: t("admin.shipping") },
		{ value: "policies", label: t("admin.policies") },
	];
	if (!ready) return null;
	return (
		<div>
			<AdminGate isAdmin={session?.role === "admin"}>
				{value === "overview" ? null : (
					<AdminTabs
						value={value}
						items={items}
						onChange={(next) => {
							navigate(`/admin/${next}`);
						}}
					/>
				)}
				{children}
			</AdminGate>
		</div>
	);
}
