import Paper from "@shpaw415/mui-lite/Paper";
import Skeleton from "@shpaw415/mui-lite/Skeleton";
import Typography from "@shpaw415/mui-lite/Typography";
import { ThrowNotFound } from "frame-master-plugin-apply-react/utils";
import { useEffect, useState } from "react";
import { POST as getPolicy } from "../../actions/api/policies.ts";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import { usePath } from "../../hooks/usePath.ts";

function slugFromPath(pathname: string): string {
	const segments = pathname.split("/").filter(Boolean);
	return decodeURIComponent(segments[segments.length - 1] ?? "");
}

export default function PolicyPage() {
	const { locale } = useLocale();
	const t = useT();
	const slug = slugFromPath(usePath() ?? "");
	const [policy, setPolicy] = useState<
		Awaited<ReturnType<typeof getPolicy>> | undefined
	>(undefined);

	useEffect(() => {
		if (!slug) return;
		getPolicy(slug)
			.then(setPolicy)
			.catch(() => setPolicy(null));
	}, [slug]);

	if (policy === undefined) return <Skeleton variant="rounded" height={240} />;
	if (!policy) {
		ThrowNotFound();
		return null;
	}
	const title = locale === "fr" ? policy.titleFr : policy.titleEn;
	const body = locale === "fr" ? policy.bodyFr : policy.bodyEn;
	return (
		<Paper variant="outlined" className="market-policy">
			<Typography variant="h3" component="h1">
				{title}
			</Typography>
			<Typography className="market-policy-body">
				{body || t("policies.emptyBody")}
			</Typography>
		</Paper>
	);
}
