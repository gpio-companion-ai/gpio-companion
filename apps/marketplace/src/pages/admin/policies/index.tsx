import { GET, PATCH, PUT } from "@api/admin/policies";
import Button from "@shpaw415/mui-lite/Button";
import Chip from "@shpaw415/mui-lite/Chip";
import Paper from "@shpaw415/mui-lite/Paper";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { useCallback, useEffect, useState } from "react";
import AdminSection from "../../../components/AdminSection.tsx";
import { useT } from "../../../hooks/useLocale.tsx";

type Policy = Awaited<ReturnType<typeof GET>>[number];

export default function AdminPoliciesPage() {
	const t = useT();
	const [policies, setPolicies] = useState<Policy[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);
	const [selectedId, setSelectedId] = useState("");
	const [titleEn, setTitleEn] = useState("");
	const [titleFr, setTitleFr] = useState("");
	const [bodyEn, setBodyEn] = useState("");
	const [bodyFr, setBodyFr] = useState("");
	const [busy, setBusy] = useState(false);

	const fill = useCallback((policy: Policy) => {
		setSelectedId(policy.id);
		setTitleEn(policy.titleEn);
		setTitleFr(policy.titleFr);
		setBodyEn(policy.bodyEn);
		setBodyFr(policy.bodyFr);
	}, []);

	const reload = useCallback(async () => {
		setLoading(true);
		setError(null);
		try {
			const list = await GET();
			setPolicies(list);
			const current =
				list.find((policy) => policy.id === selectedId) ?? list[0];
			if (current) fill(current);
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setLoading(false);
		}
	}, [selectedId, fill]);

	useEffect(() => {
		void reload();
	}, [reload]);

	const selected = policies.find((policy) => policy.id === selectedId);

	async function save() {
		if (!selected) return;
		setBusy(true);
		setError(null);
		try {
			await PUT(selected.id, {
				slug: selected.slug,
				titleEn: titleEn.trim(),
				titleFr: titleFr.trim(),
				bodyEn,
				bodyFr,
			});
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	async function publish() {
		if (!selected) return;
		setBusy(true);
		setError(null);
		try {
			await PATCH(selected.id, "published");
			await reload();
		} catch (err) {
			setError(err instanceof Error ? err.message : String(err));
		} finally {
			setBusy(false);
		}
	}

	return (
		<AdminSection value="policies">
			<Typography variant="h4" component="h1">
				{t("admin.policies")}
			</Typography>
			<Typography color="textSecondary">{t("admin.policyBodies")}</Typography>
			{error ? (
				<Paper variant="outlined" style={{ padding: "0.8rem 1.2rem" }}>
					<Typography color="error">{error}</Typography>
				</Paper>
			) : null}
			{loading ? (
				<Typography color="textSecondary">{t("state.loading")}</Typography>
			) : (
				<Paper variant="outlined" className="market-admin-form">
					<div className="bar" style={{ marginTop: 0 }}>
						{policies.map((policy) => (
							<Button
								key={policy.id}
								variant={policy.id === selectedId ? "contained" : "outlined"}
								size="small"
								onClick={() => fill(policy)}
							>
								{policy.slug}
							</Button>
						))}
					</div>
					<div className="market-form-row">
						<TextField
							label={t("admin.titleEn")}
							value={titleEn}
							onChange={(event) => setTitleEn(event.target.value)}
						/>
						<TextField
							label={t("admin.titleFr")}
							value={titleFr}
							onChange={(event) => setTitleFr(event.target.value)}
						/>
					</div>
					<TextField
						label={t("admin.bodyEn")}
						multiline
						value={bodyEn}
						onChange={(event) => setBodyEn(event.target.value)}
					/>
					<TextField
						label={t("admin.bodyFr")}
						multiline
						value={bodyFr}
						onChange={(event) => setBodyFr(event.target.value)}
					/>
					<div className="bar">
						{selected?.status === "published" ? (
							<Chip size="small" color="success">
								published
							</Chip>
						) : (
							<Chip size="small" color="warning">
								draft
							</Chip>
						)}
						<Button variant="contained" disabled={busy} onClick={save}>
							{t("admin.saveDraft")}
						</Button>
						<Button variant="outlined" disabled={busy} onClick={publish}>
							{t("admin.publish")}
						</Button>
					</div>
				</Paper>
			)}
		</AdminSection>
	);
}
