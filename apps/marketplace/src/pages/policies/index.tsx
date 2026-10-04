import Paper from "@shpaw415/mui-lite/Paper";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useState } from "react";
import { GET as listPolicies } from "../../actions/api/policies.ts";
import EmptyState from "../../components/EmptyState.tsx";
import { useLocale, useT } from "../../hooks/useLocale.tsx";

export default function PoliciesPage() {
	const t = useT();
	const { locale } = useLocale();
	const [policies, setPolicies] = useState<
		Awaited<ReturnType<typeof listPolicies>>
	>([]);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		listPolicies()
			.then(setPolicies)
			.catch(() => setPolicies([]))
			.finally(() => setLoading(false));
	}, []);

	if (!loading && policies.length === 0) {
		return (
			<EmptyState
				title={t("policies.emptyTitle")}
				description={t("policies.emptyBody")}
			/>
		);
	}
	return (
		<div>
			<Typography variant="h3" component="h1">
				{t("policies.title")}
			</Typography>
			<div className="market-points">
				{policies.map((policy) => (
					<Paper key={policy.id} variant="outlined" className="market-point">
						<a href={`/policies/${policy.slug}`}>
							<Typography variant="h6">
								{locale === "fr" ? policy.titleFr : policy.titleEn}
							</Typography>
						</a>
					</Paper>
				))}
			</div>
		</div>
	);
}
