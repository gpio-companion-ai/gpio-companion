import Paper from "@shpaw415/mui-lite/Paper";
import Select from "@shpaw415/mui-lite/Select";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { LOCALES } from "gpio-companion/i18n";
import { asLocale, useLocale } from "../hooks/useLocale.tsx";

export default function LanguageCard({ menuZIndex }: { menuZIndex?: number }) {
	const { locale, setLocale, t } = useLocale();

	return (
		<Paper className="w-full p-3" elevation={1}>
			<Stack
				direction="row"
				spacing={1}
				className="flex-wrap items-center justify-between"
			>
				<Typography variant="subtitle1">{t("language.title")}</Typography>
				<Select
					SlotProps={
						menuZIndex
							? { "dropdown-wrapper": { sx: { zIndex: menuZIndex } } }
							: undefined
					}
					name="locale"
					label={t("language.title")}
					value={locale}
					onSelect={(next) => setLocale(asLocale(next))}
					className="w-full max-w-xs"
				>
					{LOCALES.map((entry) => (
						<option key={entry.code} value={entry.code}>
							{entry.nativeLabel}
						</option>
					))}
				</Select>
			</Stack>
		</Paper>
	);
}
