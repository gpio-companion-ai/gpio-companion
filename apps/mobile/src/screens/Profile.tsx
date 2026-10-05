import { useFocusEffect } from "expo-router";
import { openSupportChat } from "gpio-companion-support";
import { useCallback, useEffect, useRef, useState } from "react";
import { findNodeHandle, Linking, type ScrollView, View } from "react-native";
import AddressForm from "../components/AddressForm.tsx";
import BoardAlertSettings from "../components/BoardAlertSettings.tsx";
import ExperienceCard from "../components/ExperienceCard.tsx";
import LanguageCard from "../components/LanguageCard.tsx";
import UsageChartsWebView from "../components/UsageChartsWebView.tsx";
import {
	Body,
	ErrorText,
	Muted,
	Paper,
	PrimaryButton,
	Screen,
	Skeleton,
	TextButton,
} from "../components/ui.tsx";
import VoiceCard from "../components/VoiceCard.tsx";
import { getCredits, getCreditsUsage, listDeviceStatus } from "../lib/api.ts";
import { CACHE_KEYS, useCachedQuery } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { dashboardUrl } from "../lib/config.ts";
import { type ProfileSection, useDeckNav } from "../lib/deck-nav.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import Keys from "./Keys.tsx";

export default function Profile() {
	const auth = useAuth();
	const token = auth.token;
	const creditsQuery = useCachedQuery(CACHE_KEYS.credits, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return getCredits(token);
	});
	const credits = creditsQuery.data ?? null;
	const usageQuery = useCachedQuery(CACHE_KEYS.creditsUsage, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return getCreditsUsage(token);
	});
	const usage = usageQuery.data ?? null;
	const t = useT();
	const [error, setError] = useState("");
	const { registerProfileJump, consumeProfileJump } = useDeckNav();
	const scrollRef = useRef<ScrollView>(null);
	const sectionRefs = useRef<Record<ProfileSection, View | null>>({
		account: null,
		github: null,
		credits: null,
		address: null,
	});

	const scrollToSection = useCallback((section: ProfileSection) => {
		const node = sectionRefs.current[section];
		const scroll = scrollRef.current;
		const handle = scroll ? findNodeHandle(scroll) : null;
		if (!node || !scroll || !handle) {
			return;
		}
		node.measureLayout(
			handle,
			(_x, y) => {
				scroll.scrollTo({ y: Math.max(0, y - 8), animated: true });
			},
			() => undefined,
		);
	}, []);

	useEffect(() => {
		registerProfileJump(scrollToSection);
		return () => registerProfileJump(null);
	}, [registerProfileJump, scrollToSection]);

	useFocusEffect(
		useCallback(() => {
			const timer = setTimeout(() => {
				const section = consumeProfileJump();
				if (section) {
					scrollToSection(section);
				}
			}, 60);
			return () => clearTimeout(timer);
		}, [consumeProfileJump, scrollToSection]),
	);

	return (
		<Screen scrollRef={scrollRef}>
			<ErrorText>
				{translateError(t, error || creditsQuery.error || "")}
			</ErrorText>
			<LanguageCard />
			{token ? <ExperienceCard token={token} /> : null}
			{token ? <VoiceCard token={token} /> : null}
			{token ? <BoardAlertSettings /> : null}
			<View
				collapsable={false}
				ref={(node) => {
					sectionRefs.current.account = node;
				}}
			>
				<Paper>
					<Body>{t("profile.account")}</Body>
					<Body>{auth.session?.name || t("auth.signedIn")}</Body>
					<Muted>{auth.session?.email}</Muted>
					<Muted>
						{t("profile.role", {
							role: auth.session?.role || t("profile.roleUser"),
						})}
					</Muted>
					<TextButton
						label={t("auth.signOut")}
						onPress={() => void auth.logout()}
					/>
				</Paper>
			</View>
			<View
				collapsable={false}
				ref={(node) => {
					sectionRefs.current.github = node;
				}}
			>
				<Keys />
			</View>
			<View
				collapsable={false}
				ref={(node) => {
					sectionRefs.current.credits = node;
				}}
			>
				<Paper>
					<Body>{t("credits.title")}</Body>
					{creditsQuery.loading ? (
						<Skeleton height={24} />
					) : (
						<Muted>
							{credits
								? t("credits.balance", {
										usd: credits.usd.toFixed(2),
										micros: credits.micros,
									})
								: t("credits.noCredits")}
						</Muted>
					)}
					<PrimaryButton
						label={t("credits.add")}
						onPress={() => {
							setError("");
							void Linking.openURL(`${dashboardUrl}/profile/credits`).catch(
								(caught) => {
									setError(
										caught instanceof Error
											? caught.message
											: t("errors.couldNotOpenCredits"),
									);
								},
							);
						}}
					/>
					<Body>{t("credits.usageTitle")}</Body>
					{usageQuery.loading ? (
						<Skeleton height={24} />
					) : usage && usage.calls > 0 ? (
						<UsageChartsWebView summary={usage} />
					) : (
						<Muted>{t("credits.usageEmpty")}</Muted>
					)}
					<TextButton
						label={t("credits.usageView")}
						onPress={() => {
							setError("");
							void Linking.openURL(
								`${dashboardUrl}/profile/credits#usage`,
							).catch((caught) => {
								setError(
									caught instanceof Error
										? caught.message
										: t("errors.couldNotOpenCredits"),
								);
							});
						}}
					/>
				</Paper>
			</View>
			<View
				collapsable={false}
				ref={(node) => {
					sectionRefs.current.address = node;
				}}
			>
				<AddressForm token={token} />
			</View>
			<BugReportCard token={token} />
		</Screen>
	);
}

function BugReportCard({ token }: { token: string | null }) {
	const t = useT();
	const { uuid } = useBoardSelection();
	const boardsQuery = useCachedQuery(CACHE_KEYS.userBoards, () => {
		if (!token) {
			return Promise.reject(new Error("sign in first"));
		}
		return listDeviceStatus(token);
	});
	const board = boardsQuery.data?.devices.find(
		(item) => item.device.uuid === uuid,
	);
	const boardLabel = [board?.device.label, board?.status?.model]
		.filter(Boolean)
		.join(" · ");

	return (
		<Paper>
			<Body>{t("profile.bugTitle")}</Body>
			<Muted>{t("profile.bugHint")}</Muted>
			{boardLabel ? (
				<Muted>{t("profile.bugBoard", { board: boardLabel })}</Muted>
			) : null}
			<PrimaryButton
				label={t("profile.bugOpen")}
				onPress={() => openSupportChat()}
			/>
		</Paper>
	);
}
