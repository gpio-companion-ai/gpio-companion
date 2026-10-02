import Typography from "@shpaw415/mui-lite/Typography";
import type { ECharts } from "echarts";
import {
	buildUsageAreaOption,
	buildUsageLeaderboardOption,
	buildUsageVoiceOption,
	type UsageChartSummary,
} from "gpio-companion";
import { useEffect, useMemo, useRef } from "react";
import { useT } from "../hooks/useLocale.tsx";

function Chart({
	option,
	height,
	label,
}: {
	option: Record<string, unknown>;
	height: number;
	label: string;
}) {
	const ref = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		let chart: ECharts | null = null;
		let cancelled = false;
		void import("echarts").then((echarts) => {
			if (cancelled || !ref.current) {
				return;
			}
			chart = echarts.init(ref.current);
			chart.setOption(option as never);
		});
		function resize() {
			chart?.resize();
		}
		window.addEventListener("resize", resize);
		return () => {
			cancelled = true;
			window.removeEventListener("resize", resize);
			chart?.dispose();
			chart = null;
		};
	}, [option]);
	return (
		<div
			ref={ref}
			role="img"
			aria-label={label}
			style={{ width: "100%", height }}
		/>
	);
}

export default function UsageCharts({
	summary,
	dark,
	headings = true,
}: {
	summary: UsageChartSummary;
	dark: boolean;
	headings?: boolean;
}) {
	const t = useT();
	const theme = useMemo(() => ({ dark }), [dark]);
	const areaOption = useMemo(
		() => buildUsageAreaOption(summary, theme),
		[summary, theme],
	);
	const boardOption = useMemo(
		() => buildUsageLeaderboardOption(summary, theme),
		[summary, theme],
	);
	const voiceOption = useMemo(
		() => buildUsageVoiceOption(summary, theme),
		[summary, theme],
	);
	const boardHeight = Math.min(140 + summary.byModel.length * 40, 480);
	return (
		<>
			{headings ? (
				<Typography variant="subtitle1">{t("credits.usageDaily")}</Typography>
			) : null}
			<Chart option={areaOption} height={340} label={t("credits.usageDaily")} />
			{headings ? (
				<Typography variant="subtitle1">
					{t("credits.usageLeaderboard")}
				</Typography>
			) : null}
			<Chart
				option={boardOption}
				height={boardHeight}
				label={t("credits.usageLeaderboard")}
			/>
			{headings ? (
				<Typography variant="subtitle1">{t("credits.usageVoice")}</Typography>
			) : null}
			<Chart
				option={voiceOption}
				height={300}
				label={t("credits.usageVoice")}
			/>
		</>
	);
}
