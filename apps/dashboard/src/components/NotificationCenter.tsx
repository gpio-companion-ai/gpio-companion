import { POST as decideNote, GET as listNotes } from "@api/notifications";
import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import { List, ListItem, ListItemText } from "@shpaw415/mui-lite/List";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { translateError } from "gpio-companion/i18n";
import { useEffect, useState } from "react";
import { useActionError } from "../hooks/useActionError.tsx";
import { useAuthSession } from "../hooks/useAuth.ts";
import { useT } from "../hooks/useLocale.tsx";
import useMobile from "../hooks/useMobile.ts";
import { unwrapAction } from "../lib/action.ts";
import { openLoginDialog } from "../lib/auth/refresh.ts";
import { ListSkeleton } from "./skeletons.tsx";

type Item = {
	uuid: string;
	requesterEmail: string;
	login: string;
	createdAt: string;
};

export default function NotificationCenter() {
	const session = useAuthSession();
	const { run } = useActionError();
	const t = useT();
	const mobile = useMobile();
	const [items, setItems] = useState<Item[]>([]);
	const [loading, setLoading] = useState(true);
	const [message, setMessage] = useState("");
	const [error, setError] = useState("");

	useEffect(() => {
		if (!session.data?.id) {
			setLoading(false);
			return;
		}
		setLoading(true);
		void run(listNotes())
			.then((result) => {
				if (result) {
					setItems(result.items);
				}
			})
			.finally(() => {
				setLoading(false);
			});
	}, [session.data?.id, run]);

	if (!session.data?.id) {
		return (
			<Typography color="secondary">
				<Button onClick={openLoginDialog} variant="text">
					{t("auth.signIn")}
				</Button>{" "}
				{t("auth.toRequests")}
			</Typography>
		);
	}

	return (
		<Paper className="w-full max-w-xl p-4 min-[900px]:p-6" elevation={1}>
			<Stack spacing={2}>
				<Typography>{t("requests.hint")}</Typography>
				{loading ? (
					<ListSkeleton items={2} />
				) : items.length === 0 ? (
					<Typography color="secondary">{t("requests.empty")}</Typography>
				) : (
					<List>
						{items.map((item) => (
							<ListItem
								key={item.uuid}
								sx={{
									flexDirection: mobile ? "column" : "row",
									alignItems: mobile ? "stretch" : "center",
									gap: 1,
								}}
							>
								<ListItemText
									primary={t("requests.wants", {
										email: item.requesterEmail || item.login,
										uuid: item.uuid,
									})}
									secondary={item.createdAt}
									className="min-w-0 break-all"
								/>
								<Stack
									direction={mobile ? "column" : "row"}
									spacing={1}
									className={mobile ? "w-full" : undefined}
								>
									<Button
										variant="contained"
										className={mobile ? "w-full" : undefined}
										onClick={() => {
											void decideNote({ uuid: item.uuid, action: "accept" })
												.then(async (result) => {
													unwrapAction(result);
													setMessage(t("requests.transferred"));
													const next = await run(listNotes());
													if (next) {
														setItems(next.items);
													}
												})
												.catch((caught: unknown) => {
													setError(
														translateError(
															t,
															caught instanceof Error
																? caught.message
																: "accept failed",
														),
													);
												});
										}}
									>
										{t("requests.accept")}
									</Button>
									<Button
										variant="outlined"
										className={mobile ? "w-full" : undefined}
										onClick={() => {
											void decideNote({ uuid: item.uuid, action: "reject" })
												.then(async (result) => {
													unwrapAction(result);
													setMessage(t("requests.rejected"));
													const next = await run(listNotes());
													if (next) {
														setItems(next.items);
													}
												})
												.catch((caught: unknown) => {
													setError(
														translateError(
															t,
															caught instanceof Error
																? caught.message
																: "reject failed",
														),
													);
												});
										}}
									>
										{t("requests.reject")}
									</Button>
								</Stack>
							</ListItem>
						))}
					</List>
				)}
				{message ? <Alert severity="success">{message}</Alert> : null}
				{error ? <Alert severity="error">{error}</Alert> : null}
			</Stack>
		</Paper>
	);
}
