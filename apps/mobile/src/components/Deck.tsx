import MaterialIcons from "@expo/vector-icons/MaterialIcons";
import { usePathname, useRouter } from "expo-router";
import type { UiModalCommand } from "gpio-companion-ui";
import {
	type ReactNode,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	Animated,
	AppState,
	DeviceEventEmitter,
	Image,
	Modal,
	PanResponder,
	Pressable,
	ScrollView,
	Text,
	TextInput,
	useWindowDimensions,
	View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
	type ArduinoProxyStatus,
	type BoardSketch,
	type BoardView,
	deviceDisplayName,
	type FlashPort,
	type FlashStatus,
	type GpioSnapshot,
	listDeviceStatus,
	loadArduinoProxy,
	loadFlash,
	loadFlashPorts,
	loadFlashSketches,
	loadRun,
	type RunStatus,
	startFlash,
	startFlashProxy,
	stopRun,
} from "../lib/api.ts";
import { useUserBoards } from "../lib/api-cache.tsx";
import { useAuth } from "../lib/auth.tsx";
import { useBoardSelection } from "../lib/board-selection.tsx";
import { useColorMode } from "../lib/color-mode.tsx";
import { type DeviceTabId, deviceTabs } from "../lib/dashboard-mode.ts";
import { useDashboardMode } from "../lib/dashboard-mode.tsx";
import { type DeckKey, useDeckT } from "../lib/deck-i18n.ts";
import {
	DeckNavProvider,
	type ProfileSection,
	type SidebarEntry,
	useDeckNav,
} from "../lib/deck-nav.tsx";
import { useDeviceHub } from "../lib/device-hub.tsx";
import { translateError, useT } from "../lib/locale.tsx";
import { storageGet, storageSet } from "../lib/storage.ts";
import { setPendingUiApp } from "../lib/ui-app.ts";
import { setPendingUiPreview } from "../lib/ui-preview.ts";
import { useConsoleTunnel } from "../lib/use-console-tunnel.ts";
import { useDeviceHub as useLiveHub } from "../lib/use-device-hub.ts";
import { useGpioTunnel } from "../lib/use-gpio-tunnel.ts";
import { useUiSocket } from "../lib/use-ui-socket.ts";
import AppWebView from "./AppWebView.tsx";
import BoardPresenceAlerts from "./BoardPresenceAlerts.tsx";
import { ErrorText, PrimaryButton, TextButton } from "./ui.tsx";

const logo = require("../../assets/logo.png");
const DOCK_STORAGE_KEY = "b6-dockH";
const DOCK_COLLAPSED_KEY = "b6-dockCollapsed";
const PROJECT_STORAGE_KEY = "gpio-companion-selected-project";
function pickMobileFlashTarget(
	ports: FlashPort[],
	hint?: { connected?: boolean; port?: string; fqbn?: string } | null,
) {
	const connected = hint?.connected === true;
	const hintPort = hint?.port?.trim() ?? "";
	const hintFqbn = hint?.fqbn?.trim() ?? "";
	const matched = connected
		? (ports.find((item) => hintPort && item.address === hintPort) ??
			ports.find((item) => hintFqbn && item.fqbn === hintFqbn))
		: undefined;
	const fallback = ports.find((item) => item.fqbn?.trim()) ?? ports[0];
	if (connected) {
		return {
			port: matched?.address || hintPort || fallback?.address || "",
			fqbn: matched?.fqbn?.trim() || hintFqbn || fallback?.fqbn?.trim() || "",
		};
	}
	return {
		port: fallback?.address ?? "",
		fqbn: fallback?.fqbn?.trim() ?? "",
	};
}
const DOCK_MIN = 64;
const DOCK_MAX = 480;
const DOCK_DEFAULT = 150;

type Command = {
	id: string;
	labelKey: DeckKey;
	run: () => void;
};

type NavigationDeckKey = Extract<
	DeckKey,
	`deck.${"project" | "devices" | "profile" | DeviceTabId}`
>;

const deviceLabelKeys: Record<DeviceTabId, NavigationDeckKey> = {
	overview: "deck.overview",
	docs: "deck.docs",
	code: "deck.code",
	pair: "deck.pair",
	wifi: "deck.wifi",
	requests: "deck.requests",
	debug: "deck.debug",
	admin: "deck.admin",
};

function publicBoardName(
	board: BoardView,
	expert: boolean,
	unnamed: string,
): string {
	const label = board.device.label?.trim();
	if (label && label !== board.device.uuid) {
		return label;
	}
	if (board.status?.model) {
		return board.status.model;
	}
	return expert ? board.device.uuid.slice(0, 8) : unnamed;
}

export default function Deck({ children }: { children: ReactNode }) {
	return (
		<DeckNavProvider>
			<DeckFrame>{children}</DeckFrame>
		</DeckNavProvider>
	);
}

function DeckFrame({ children }: { children: ReactNode }) {
	const colors = useColorMode().colors;
	const { isDark, toggleMode: toggleTheme } = useColorMode();
	const { mode, isEasy, toggleMode } = useDashboardMode();
	const { tab, setTab } = useDeviceHub();
	const tCore = useT();
	const auth = useAuth();
	const router = useRouter();
	const pathname = usePathname();
	const insets = useSafeAreaInsets();
	const { width: windowWidth } = useWindowDimensions();
	const t = useDeckT();
	const { boards, refetch: refreshPresenceBoards } = useUserBoards();
	const { uuid: selectedBoardUuid, setUuid: selectBoard } = useBoardSelection();
	const {
		workItems,
		docsItems,
		profileSection,
		setProfileSection,
		jumpProfile,
	} = useDeckNav();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [query, setQuery] = useState("");
	const drawerWidth = Math.min(windowWidth * 0.82, 280);
	const drawerX = useRef(new Animated.Value(-280)).current;

	const navigate = useCallback(
		(path: "/project" | "/" | "/profile") => {
			if (path === "/profile") {
				setProfileSection("account");
			}
			router.navigate(path);
		},
		[router, setProfileSection],
	);

	const [uiToast, setUiToast] = useState<string | null>(null);
	const [uiModal, setUiModal] = useState<UiModalCommand | null>(null);
	const [uiApp, setUiApp] = useState<{
		appId: string;
		title: string;
		full: boolean;
	} | null>(null);
	const uiToastTimer = useRef(0);
	const admin = auth.session?.role === "admin";

	const uiSocket = useUiSocket({
		surface: "mobile",
		enabled: Boolean(auth.token && selectedBoardUuid),
		uuid: selectedBoardUuid,
		authToken: auth.token ?? "",
		isFocused: () => AppState.currentState === "active",
		onCommand: (command) => {
			switch (command.type) {
				case "navigate": {
					const target = command.target;
					if (
						(target === "debug" || target === "admin") &&
						(isEasy || !admin)
					) {
						return;
					}
					if (target === "project") {
						navigate("/project");
						return;
					}
					if (target === "devices") {
						setTab("overview");
						navigate("/");
						return;
					}
					if (target === "profile") {
						jumpProfile("account");
						router.navigate("/profile");
						return;
					}
					if (target === "github" || target === "credits") {
						jumpProfile(target);
						router.navigate("/profile");
						return;
					}
					if (
						target === "code" ||
						target === "docs" ||
						target === "pair" ||
						target === "wifi" ||
						target === "requests"
					) {
						// Already there: skip re-navigation so Code chat state stays mounted.
						if (tab !== target || pathname !== "/") {
							setTab(target);
							navigate("/");
						}
					}
					return;
				}
				case "dock": {
					DeviceEventEmitter.emit("gpio-ui-dock", { tab: command.tab });
					if (pathname.includes("profile")) {
						router.navigate("/project");
					}
					return;
				}
				case "palette":
					setPaletteOpen(command.open);
					return;
				case "toast":
					setUiToast(command.text);
					if (uiToastTimer.current) {
						clearTimeout(uiToastTimer.current);
					}
					uiToastTimer.current = setTimeout(
						() => setUiToast(null),
						4000,
					) as unknown as number;
					return;
				case "modal":
					setUiModal(command);
					return;
				case "preview": {
					// Already on Code: only emit the preview event so the
					// active chat session stays mounted.
					if (tab !== "code" || pathname !== "/") {
						setTab("code");
						navigate("/");
					}
					const detail = { repo: command.repo, path: command.path };
					setPendingUiPreview(detail);
					DeviceEventEmitter.emit("gpio-ui-preview", detail);
					return;
				}
				case "app": {
					if (command.view === "modal") {
						setUiApp({
							appId: command.appId,
							title: command.title,
							full: false,
						});
						return;
					}
					if (command.view === "page") {
						setUiApp({
							appId: command.appId,
							title: command.title,
							full: true,
						});
						return;
					}
					// split: open beside the chat, in the Code files pane.
					if (tab !== "code" || pathname !== "/") {
						setTab("code");
						navigate("/");
					}
					const detail = { appId: command.appId, title: command.title };
					setPendingUiApp(detail);
					DeviceEventEmitter.emit("gpio-ui-app", detail);
					return;
				}
			}
		},
	});

	function closeUiModal(action: string) {
		if (!uiModal) {
			return;
		}
		uiSocket.reply(uiModal.id, action);
		setUiModal(null);
	}
	const commands = useMemo<Command[]>(() => {
		const base: Command[] = [
			{
				id: "project",
				labelKey: "deck.project",
				run: () => navigate("/project"),
			},
			{ id: "devices", labelKey: "deck.devices", run: () => navigate("/") },
			{
				id: "profile",
				labelKey: "deck.profile",
				run: () => navigate("/profile"),
			},
		];
		const deviceCommands = deviceTabs(
			mode,
			auth.session?.role === "admin",
		).map<Command>((item) => ({
			id: `device-${item.id}`,
			labelKey: deviceLabelKeys[item.id],
			run: () => {
				setTab(item.id);
				navigate("/");
			},
		}));
		const boardCommands: Command[] = [
			{
				id: "action-run",
				labelKey: "deck.boardRun",
				run: () => navigate("/project"),
			},
			{
				id: "action-flash",
				labelKey: "deck.boardFlash",
				run: () => navigate("/project"),
			},
			{
				id: "action-verify",
				labelKey: "deck.boardVerify",
				run: () => navigate("/project"),
			},
			{
				id: "action-save",
				labelKey: "deck.boardSave",
				run: () => navigate("/project"),
			},
			{
				id: "action-buy",
				labelKey: "deck.boardBuy",
				run: () => navigate("/profile"),
			},
			{
				id: "mode-easy",
				labelKey: "deck.useEasy",
				run: () => {
					if (!isEasy) toggleMode();
				},
			},
			{
				id: "mode-expert",
				labelKey: "deck.useExpert",
				run: () => {
					if (isEasy) toggleMode();
				},
			},
			{
				id: "theme",
				labelKey: "deck.theme",
				run: () => toggleTheme(),
			},
		];
		const seen = new Set<string>();
		return base
			.concat(deviceCommands)
			.concat(boardCommands)
			.filter((command) => {
				const label = command.labelKey;
				if (seen.has(label)) return false;
				seen.add(label);
				return true;
			});
	}, [
		auth.session?.role,
		isEasy,
		mode,
		navigate,
		setTab,
		toggleMode,
		toggleTheme,
	]);

	const filtered = commands.filter((command) =>
		t(command.labelKey)
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase()),
	);
	const run = (command: Command) => {
		setDrawerOpen(false);
		setPaletteOpen(false);
		setQuery("");
		command.run();
	};

	useEffect(() => {
		Animated.timing(drawerX, {
			toValue: drawerOpen ? 0 : -drawerWidth,
			duration: 160,
			useNativeDriver: true,
		}).start();
	}, [drawerOpen, drawerWidth, drawerX]);

	useEffect(() => {
		setDrawerOpen(false);
	}, [pathname, tab]);

	const contextKey: DeckKey = pathname.includes("project")
		? "deck.project"
		: pathname.includes("profile")
			? "deck.profile"
			: deviceLabelKeys[tab];

	return (
		<View
			style={{ flex: 1, backgroundColor: colors.bg, paddingTop: insets.top }}
		>
			<View
				style={{
					height: 48,
					flexDirection: "row",
					alignItems: "center",
					paddingHorizontal: 8,
					gap: 4,
					borderBottomWidth: 1,
					borderBottomColor: colors.border,
					backgroundColor: colors.surface,
				}}
			>
				<Pressable
					onPress={() => setDrawerOpen(true)}
					accessibilityRole="button"
					accessibilityLabel={t("deck.menu")}
					style={{ padding: 8 }}
				>
					<MaterialIcons name="menu" size={22} color={colors.text} />
				</Pressable>
				<Image
					source={logo}
					style={{ width: 26, height: 26, borderRadius: 7 }}
				/>
				<Text
					style={{
						color: colors.text,
						fontSize: 16,
						fontWeight: "700",
						flex: 1,
					}}
				>
					{t("deck.brandShort")}
				</Text>
				<Pressable
					onPress={() => setPaletteOpen(true)}
					accessibilityRole="button"
					accessibilityLabel={t("deck.search")}
					style={{ padding: 8 }}
				>
					<MaterialIcons name="search" size={22} color={colors.text} />
				</Pressable>
				<Pressable onPress={toggleMode} style={{ padding: 7 }}>
					<Text
						style={{ color: colors.primary, fontWeight: "700", fontSize: 12 }}
					>
						{isEasy ? t("deck.easy") : t("deck.expert")}
					</Text>
				</Pressable>
				<Pressable
					onPress={toggleTheme}
					accessibilityRole="button"
					accessibilityLabel={
						isDark ? t("deck.switchToLight") : t("deck.switchToDark")
					}
					style={{ padding: 8 }}
				>
					<MaterialIcons
						name={isDark ? "wb-sunny" : "brightness-2"}
						size={20}
						color={colors.muted}
					/>
				</Pressable>
			</View>
			<View
				style={{
					height: 26,
					paddingHorizontal: 12,
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					backgroundColor: colors.chipBg,
				}}
			>
				<Text
					style={{ color: colors.success, fontSize: 11, fontWeight: "700" }}
				>
					{t("deck.statusReady")}
				</Text>
				<Text style={{ color: colors.muted, fontSize: 11 }} numberOfLines={1}>
					{t("deck.statusContext", { context: t(contextKey) })}
				</Text>
			</View>
			<View style={{ flex: 1 }}>{children}</View>
			{pathname.includes("profile") ? null : <DeckDock isEasy={isEasy} />}
			<BottomNav
				active={
					pathname.includes("project")
						? "/project"
						: pathname.includes("profile")
							? "/profile"
							: "/"
				}
				onNavigate={navigate}
			/>

			<Modal
				visible={drawerOpen}
				transparent
				animationType="none"
				onRequestClose={() => setDrawerOpen(false)}
			>
				<View
					style={{
						flex: 1,
						paddingTop: insets.top + 48,
						paddingBottom: 56 + Math.max(insets.bottom - 8, 0),
					}}
				>
					<View style={{ flex: 1, flexDirection: "row" }}>
						<Animated.View
							style={{
								width: drawerWidth,
								backgroundColor: colors.surface,
								borderRightWidth: 1,
								borderRightColor: colors.border,
								transform: [{ translateX: drawerX }],
							}}
						>
							<ContextDrawer
								onClose={() => setDrawerOpen(false)}
								onOpenDevice={(id) => {
									setTab(id);
									navigate("/");
								}}
								onOpenProfile={(section) => {
									jumpProfile(section);
									router.navigate("/profile");
								}}
								onOpenLearn={() => {
									setTab("docs");
									navigate("/");
								}}
								onSelectBoard={(uuid) => {
									selectBoard(uuid);
									setDrawerOpen(false);
								}}
								boards={boards}
								selectedBoardUuid={selectedBoardUuid}
								expert={!isEasy}
								workItems={workItems}
								docsItems={docsItems}
								profileSection={profileSection}
								deviceTabs={deviceTabs(mode, auth.session?.role === "admin")}
								activeTab={tab}
								section={
									pathname.includes("profile")
										? "profile"
										: pathname.includes("project")
											? "project"
											: "devices"
								}
							/>
						</Animated.View>
						<Pressable
							onPress={() => setDrawerOpen(false)}
							accessibilityLabel={t("deck.closeNavigation")}
							style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.42)" }}
						/>
					</View>
				</View>
			</Modal>

			<Modal
				visible={paletteOpen}
				transparent
				animationType="fade"
				onRequestClose={() => setPaletteOpen(false)}
			>
				<Pressable
					onPress={() => setPaletteOpen(false)}
					style={{
						flex: 1,
						paddingTop: insets.top + 8,
						backgroundColor: "rgba(0,0,0,0.6)",
					}}
				>
					<Pressable
						onPress={() => undefined}
						style={{
							width: "100%",
							backgroundColor: colors.surface,
							padding: 12,
						}}
					>
						<TextInput
							autoFocus
							value={query}
							onChangeText={setQuery}
							onSubmitEditing={() => filtered[0] && run(filtered[0])}
							placeholder={t("deck.searchPlaceholder")}
							placeholderTextColor={colors.placeholder}
							style={{
								color: colors.text,
								borderWidth: 1,
								borderColor: colors.border,
								borderRadius: 10,
								padding: 12,
							}}
						/>
						<View style={{ marginTop: 8 }}>
							{filtered.length ? (
								filtered.map((command) => (
									<CommandRow
										key={command.id}
										label={t(command.labelKey)}
										onPress={() => run(command)}
									/>
								))
							) : (
								<Text style={{ color: colors.muted, padding: 12 }}>
									{t("deck.noResults")}
								</Text>
							)}
						</View>
					</Pressable>
				</Pressable>
			</Modal>

			<BoardPresenceAlerts
				token={auth.token}
				boards={boards.map((board) => ({
					uuid: board.device.uuid,
					name: publicBoardName(board, !isEasy, t("deck.unnamed")),
				}))}
				onChangeStatus={() => {
					void refreshPresenceBoards({ force: true }).catch(() => undefined);
				}}
			/>
			{uiToast ? (
				<View
					pointerEvents="none"
					accessibilityLiveRegion="polite"
					accessibilityLabel={tCore("deck.ui.toastLabel")}
					style={{
						position: "absolute",
						left: 16,
						right: 16,
						bottom: 140,
						backgroundColor: colors.surface,
						borderWidth: 1,
						borderColor: colors.border,
						borderRadius: 10,
						paddingVertical: 10,
						paddingHorizontal: 14,
					}}
				>
					<Text style={{ color: colors.text, fontSize: 13 }}>{uiToast}</Text>
				</View>
			) : null}

			<Modal
				visible={Boolean(uiModal)}
				transparent
				animationType="fade"
				onRequestClose={() => closeUiModal("dismiss")}
			>
				<Pressable
					onPress={() => closeUiModal("dismiss")}
					style={{
						flex: 1,
						alignItems: "center",
						justifyContent: "center",
						padding: 24,
						backgroundColor: "rgba(0,0,0,0.6)",
					}}
				>
					<Pressable
						onPress={() => undefined}
						accessibilityRole="alert"
						accessibilityLabel={`${tCore("deck.ui.modalTitle")}: ${uiModal?.title ?? ""}`}
						style={{
							width: "100%",
							maxWidth: 420,
							backgroundColor: colors.surface,
							borderRadius: 14,
							padding: 16,
						}}
					>
						<Text
							style={{
								color: colors.text,
								fontSize: 17,
								fontWeight: "700",
							}}
						>
							{uiModal?.title ?? ""}
						</Text>
						<Text
							style={{
								color: colors.text,
								fontSize: 14,
								marginTop: 10,
							}}
						>
							{uiModal?.body ?? ""}
						</Text>
						<View
							style={{
								flexDirection: "row",
								justifyContent: "flex-end",
								flexWrap: "wrap",
								gap: 8,
								marginTop: 16,
							}}
						>
							{(uiModal?.buttons ?? []).map((label) => (
								<TextButton
									key={label}
									label={label}
									onPress={() => closeUiModal(label)}
								/>
							))}
							<TextButton
								label={tCore("deck.ui.dismiss")}
								onPress={() => closeUiModal("dismiss")}
							/>
						</View>
					</Pressable>
				</Pressable>
			</Modal>

			<Modal
				visible={Boolean(uiApp)}
				animationType="slide"
				onRequestClose={() => setUiApp(null)}
			>
				<View
					style={{
						flex: 1,
						backgroundColor: colors.surface,
						paddingTop: uiApp?.full ? 0 : 44,
					}}
				>
					{uiApp && auth.token && selectedBoardUuid ? (
						<AppWebView
							token={auth.token}
							uuid={selectedBoardUuid}
							appId={uiApp.appId}
							title={uiApp.title}
							onClose={() => setUiApp(null)}
						/>
					) : null}
				</View>
			</Modal>
		</View>
	);
}

function BottomNav({
	active,
	onNavigate,
}: {
	active: "/project" | "/" | "/profile";
	onNavigate: (path: "/project" | "/" | "/profile") => void;
}) {
	const colors = useColorMode().colors;
	const insets = useSafeAreaInsets();
	const t = useDeckT();
	const items: Array<{
		path: "/project" | "/" | "/profile";
		labelKey: DeckKey;
		icon: React.ComponentProps<typeof MaterialIcons>["name"];
	}> = [
		{ path: "/project", labelKey: "deck.project", icon: "folder" },
		{ path: "/", labelKey: "deck.devices", icon: "memory" },
		{ path: "/profile", labelKey: "deck.profile", icon: "account-circle" },
	];
	return (
		<View
			style={{
				flexDirection: "row",
				backgroundColor: colors.surface,
				borderTopWidth: 1,
				borderTopColor: colors.border,
				paddingBottom: Math.max(insets.bottom, 8),
				height: 56 + Math.max(insets.bottom - 8, 0),
			}}
		>
			{items.map((item) => {
				const selected = active === item.path;
				return (
					<Pressable
						key={item.path}
						onPress={() => onNavigate(item.path)}
						accessibilityRole="tab"
						accessibilityState={{ selected }}
						style={{ flex: 1, alignItems: "center", justifyContent: "center" }}
					>
						<MaterialIcons
							name={item.icon}
							size={24}
							color={selected ? colors.primary : colors.muted}
						/>
						<Text
							style={{
								color: selected ? colors.primary : colors.muted,
								fontSize: 12,
								fontWeight: selected ? "700" : "400",
							}}
						>
							{t(item.labelKey)}
						</Text>
					</Pressable>
				);
			})}
		</View>
	);
}

function ContextDrawer({
	onClose,
	onOpenDevice,
	onOpenProfile,
	onOpenLearn,
	onSelectBoard,
	boards,
	selectedBoardUuid,
	expert,
	workItems,
	docsItems,
	profileSection,
	deviceTabs: pages,
	activeTab,
	section,
}: {
	onClose: () => void;
	onOpenDevice: (id: DeviceTabId) => void;
	onOpenProfile: (section: ProfileSection) => void;
	onOpenLearn: () => void;
	onSelectBoard: (uuid: string) => void;
	boards: BoardView[];
	selectedBoardUuid: string;
	expert: boolean;
	workItems: SidebarEntry[];
	docsItems: SidebarEntry[];
	profileSection: ProfileSection;
	deviceTabs: Array<{ id: DeviceTabId; labelKey: string }>;
	activeTab: DeviceTabId;
	section: "project" | "devices" | "profile";
}) {
	const colors = useColorMode().colors;
	const t = useDeckT();
	const title =
		section === "profile"
			? t("deck.contextYou")
			: section === "devices"
				? t("deck.contextFleet")
				: t("deck.contextWork");
	const repos = workItems.filter((item) => item.id.startsWith("repo:"));
	const files = workItems.filter((item) => item.id.startsWith("file:"));
	const profileLinks: Array<{ id: ProfileSection; label: string }> = [
		{ id: "account", label: t("deck.account") },
		{ id: "github", label: t("deck.github") },
		{ id: "credits", label: t("deck.credits") },
		{ id: "address", label: t("deck.address") },
	];

	function press(action: () => void) {
		onClose();
		requestAnimationFrame(action);
	}

	return (
		<View style={{ flex: 1, paddingTop: 14, paddingHorizontal: 10 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
					paddingHorizontal: 7,
					paddingBottom: 12,
				}}
			>
				<View style={{ flex: 1, minWidth: 0 }}>
					<Text
						style={{
							color: colors.muted,
							fontSize: 10,
							fontWeight: "700",
							letterSpacing: 1.2,
							textTransform: "uppercase",
						}}
					>
						{t("deck.contextEyebrow")}
					</Text>
					<Text
						numberOfLines={1}
						style={{ color: colors.text, fontSize: 15, fontWeight: "700" }}
					>
						{title}
					</Text>
				</View>
				<Pressable
					onPress={onClose}
					accessibilityRole="button"
					accessibilityLabel={t("deck.closeNavigation")}
					style={{ padding: 6 }}
				>
					<MaterialIcons name="close" size={20} color={colors.text} />
				</Pressable>
			</View>
			<ScrollView style={{ flex: 1 }} keyboardShouldPersistTaps="handled">
				{section === "profile"
					? profileLinks.map((item) => (
							<DrawerItem
								key={item.id}
								label={item.label}
								active={profileSection === item.id}
								onPress={() => press(() => onOpenProfile(item.id))}
							/>
						))
					: null}
				{section === "devices" ? (
					<>
						{docsItems.length && activeTab === "docs" ? (
							<>
								<DrawerLabel label={t("deck.sidebarToc")} />
								{docsItems.map((item) => (
									<DrawerItem
										key={item.id}
										label={item.label}
										onPress={
											item.onSelect
												? () => press(item.onSelect as () => void)
												: undefined
										}
									/>
								))}
							</>
						) : null}
						<DrawerLabel label={t("deck.sidebarBoards")} />
						{boards.length ? (
							boards.map((board) => (
								<DrawerItem
									key={board.device.uuid}
									label={publicBoardName(board, expert, t("deck.unnamed"))}
									active={board.device.uuid === selectedBoardUuid}
									onPress={() => onSelectBoard(board.device.uuid)}
								/>
							))
						) : (
							<DrawerLabel label={t("deck.noBoard")} />
						)}
						<DrawerLabel label={t("deck.sidebarPages")} />
						{pages.map((item) => (
							<DrawerItem
								key={item.id}
								label={t(deviceLabelKeys[item.id])}
								active={activeTab === item.id}
								child
								onPress={() => press(() => onOpenDevice(item.id))}
							/>
						))}
					</>
				) : null}
				{section === "project" ? (
					<>
						<DrawerLabel label={t("deck.sidebarRepos")} />
						{repos.length ? (
							repos.map((item) => (
								<DrawerItem
									key={item.id}
									label={item.label}
									active={item.active}
									onPress={
										item.onSelect
											? () => press(item.onSelect as () => void)
											: undefined
									}
								/>
							))
						) : (
							<DrawerLabel label={t("deck.sidebarEmpty")} />
						)}
						<DrawerLabel label={t("deck.sidebarFiles")} />
						{files.map((item) =>
							item.onSelect ? (
								<DrawerItem
									key={item.id}
									label={item.label}
									child
									onPress={() => press(item.onSelect as () => void)}
								/>
							) : (
								<DrawerLabel key={item.id} label={item.label} />
							),
						)}
						<DrawerItem
							label={t("deck.learn")}
							onPress={() => press(onOpenLearn)}
						/>
					</>
				) : null}
			</ScrollView>
			<Text
				style={{
					color: colors.muted,
					fontSize: 11,
					marginHorizontal: 7,
					marginBottom: 12,
					marginTop: 8,
				}}
			>
				{t("deck.contextHint")}
			</Text>
		</View>
	);
}

function DrawerLabel({ label }: { label: string }) {
	const colors = useColorMode().colors;
	return (
		<Text
			style={{
				marginTop: 10,
				marginBottom: 2,
				marginHorizontal: 9,
				color: colors.muted,
				fontSize: 10,
				fontWeight: "700",
				letterSpacing: 0.8,
				textTransform: "uppercase",
			}}
		>
			{label}
		</Text>
	);
}

function DrawerItem({
	label,
	active,
	child,
	onPress,
}: {
	label: string;
	active?: boolean;
	child?: boolean;
	onPress?: () => void;
}) {
	const colors = useColorMode().colors;
	return (
		<Pressable
			onPress={onPress}
			disabled={!onPress}
			accessibilityRole="button"
			accessibilityState={{ selected: Boolean(active) }}
			style={{
				paddingVertical: 7,
				paddingRight: 9,
				paddingLeft: child ? 18 : 9,
				borderRadius: 7,
				backgroundColor: active ? colors.chipBg : "transparent",
				borderLeftWidth: active ? 2 : 0,
				borderLeftColor: colors.primary,
			}}
		>
			<Text
				style={{
					color: active ? colors.text : colors.muted,
					fontSize: child ? 13 : 14,
					fontWeight: "600",
				}}
			>
				{label}
			</Text>
		</Pressable>
	);
}

function CommandRow({
	label,
	onPress,
}: {
	label: string;
	onPress: () => void;
}) {
	const colors = useColorMode().colors;
	return (
		<Pressable
			onPress={onPress}
			accessibilityRole="button"
			style={{ paddingHorizontal: 12, paddingVertical: 11, borderRadius: 8 }}
		>
			<Text style={{ color: colors.text, fontWeight: "600" }}>{label}</Text>
		</Pressable>
	);
}

type DockTab = "console" | "gpio" | "flash" | "problems" | "actions";

function DockStatusRow({ name, status }: { name: string; status: string }) {
	const colors = useColorMode().colors;
	return (
		<View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
			<Text
				style={{ color: colors.primary, fontSize: 11, fontWeight: "700" }}
				numberOfLines={1}
			>
				{name}
			</Text>
			<Text style={{ color: colors.muted, fontSize: 11 }}>{status}</Text>
		</View>
	);
}

function DockConsole({
	status,
	hostLog,
	usbLog,
	name,
	onClear,
}: {
	status: "idle" | "connecting" | "live" | "reconnecting";
	hostLog: string;
	usbLog: string;
	name: string;
	onClear: () => void;
}) {
	const colors = useColorMode().colors;
	const tCore = useT();
	const statusLabel =
		status === "live"
			? tCore("debug.live")
			: status === "idle"
				? tCore("debug.idle")
				: tCore("gpio.connecting");
	const hostTail = hostLog.length > 800 ? hostLog.slice(-800) : hostLog;
	const usbTail = usbLog.length > 800 ? usbLog.slice(-800) : usbLog;
	return (
		<View style={{ flex: 1 }}>
			<View
				style={{
					flexDirection: "row",
					alignItems: "center",
					justifyContent: "space-between",
				}}
			>
				<DockStatusRow name={name} status={statusLabel} />
				<Pressable
					onPress={onClear}
					disabled={!hostTail && !usbTail}
					style={{ opacity: !hostTail && !usbTail ? 0.45 : 1 }}
				>
					<Text style={{ color: colors.muted, fontSize: 11 }}>
						{tCore("deck.dock.consoleClear")}
					</Text>
				</Pressable>
			</View>
			<ScrollView nestedScrollEnabled style={{ flex: 1, marginTop: 4 }}>
				{hostTail ? (
					<Text
						selectable
						style={{
							color: colors.text,
							fontFamily: "monospace",
							fontSize: 11,
						}}
					>
						{hostTail}
					</Text>
				) : null}
				{usbTail ? (
					<Text
						selectable
						style={{
							color: colors.muted,
							fontFamily: "monospace",
							fontSize: 11,
							marginTop: 4,
						}}
					>
						{`${tCore("flash.serialUsb")}\n${usbTail}`}
					</Text>
				) : null}
				{!hostTail && !usbTail ? (
					<Text style={{ color: colors.muted, fontSize: 11 }}>
						{tCore("debug.noEvents")}
					</Text>
				) : null}
			</ScrollView>
		</View>
	);
}

function DockActions({ uuid, token }: { uuid: string; token: string | null }) {
	const tCore = useT();
	const colors = useColorMode().colors;
	const [stopping, setStopping] = useState(false);
	const [error, setError] = useState("");
	const [running, setRunning] = useState<boolean | null>(null);

	useEffect(() => {
		setRunning(null);
		if (!token || !uuid.trim()) {
			return;
		}
		let cancelled = false;
		void loadRun(token, uuid)
			.then((result) => {
				if (!cancelled) {
					setRunning(result.running);
				}
			})
			.catch(() => {
				if (!cancelled) {
					setRunning(null);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [uuid, token]);

	const onRun = useCallback((status: RunStatus) => {
		setRunning(status.running);
	}, []);
	useLiveHub(uuid, token, { onRun });

	async function stopSketch() {
		if (!token || !uuid || stopping) {
			return;
		}
		setError("");
		setStopping(true);
		try {
			await stopRun(token, uuid);
			setRunning((await loadRun(token, uuid)).running);
		} catch (caught) {
			setError(
				translateError(
					tCore,
					caught instanceof Error ? caught.message : "failed to stop sketch",
				),
			);
		} finally {
			setStopping(false);
		}
	}

	const runRunning = running === true;
	return (
		<View style={{ gap: 8 }}>
			{runRunning ? (
				<Text style={{ color: colors.muted, fontSize: 11 }}>
					{tCore("deck.dock.runRunning")}
				</Text>
			) : null}
			{error ? <ErrorText>{error}</ErrorText> : null}
			<TextButton
				label={
					stopping ? tCore("deck.dock.stopping") : tCore("deck.dock.stopSketch")
				}
				danger={runRunning}
				disabled={stopping || !runRunning}
				onPress={() => void stopSketch()}
			/>
		</View>
	);
}

function DockGpio({
	status,
	header,
	proxy,
	proxyStatus,
	name,
}: {
	status: "idle" | "connecting" | "live" | "reconnecting";
	header: GpioSnapshot | null;
	proxy: GpioSnapshot | null;
	proxyStatus: ArduinoProxyStatus | null;
	name: string;
}) {
	const colors = useColorMode().colors;
	const tCore = useT();
	const statusLabel =
		status === "live"
			? tCore("gpio.liveChip")
			: status === "idle"
				? tCore("debug.idle")
				: tCore("gpio.connecting");
	const proxyName =
		proxyStatus?.name?.trim() ||
		proxy?.proxy?.name?.trim() ||
		proxyStatus?.fqbn?.trim() ||
		proxy?.proxy?.fqbn?.trim() ||
		"";
	const showProxy = Boolean(proxyStatus?.connected || proxy);
	return (
		<View style={{ flex: 1 }}>
			<DockStatusRow name={name} status={statusLabel} />
			{header ? (
				<GpioSummaryLine
					snapshot={header}
					prefix={`${tCore("gpio.companion")} · ${header.hardware}`}
				/>
			) : (
				<Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
					{tCore("gpio.waiting")}
				</Text>
			)}
			{showProxy ? (
				proxy ? (
					<GpioSummaryLine
						snapshot={proxy}
						prefix={
							proxyName
								? `${tCore("gpio.arduino")} · ${proxyName}`
								: tCore("gpio.arduino")
						}
					/>
				) : (
					<Text style={{ color: colors.muted, fontSize: 11, marginTop: 4 }}>
						{proxyName
							? `${tCore("gpio.arduino")} · ${proxyName}`
							: tCore("gpio.arduino")}
					</Text>
				)
			) : null}
		</View>
	);
}

function GpioSummaryLine({
	snapshot,
	prefix,
}: {
	snapshot: GpioSnapshot;
	prefix: string;
}) {
	const colors = useColorMode().colors;
	const tCore = useT();
	const pins = snapshot.pins.filter(
		(pin) => pin.type === "gpio" && !pin.reserved && !pin.unresolved,
	);
	const high = pins.filter((pin) => pin.value === 1).length;
	const low = pins.filter((pin) => pin.value === 0).length;
	return (
		<Text style={{ color: colors.text, fontSize: 12, marginTop: 4 }}>
			{`${prefix} · ${pins.length} GPIO · ${high} ${tCore("gpio.high")} · ${low} ${tCore("gpio.low")}${
				snapshot.sketch ? ` · ${tCore("gpio.sketchReadOnly")}` : ""
			}`}
		</Text>
	);
}

function DockFlash({
	status,
	proxyStatus,
	ports,
	portsChecked,
	name,
	projectRepo,
	sketches,
	busy,
	error,
	onFlashProxy,
	onFlashSketch,
}: {
	status: FlashStatus | null;
	proxyStatus: ArduinoProxyStatus | null;
	ports: FlashPort[];
	portsChecked: boolean;
	name: string;
	projectRepo: string;
	sketches: BoardSketch[];
	busy: boolean;
	error: string;
	onFlashProxy: () => void;
	onFlashSketch: (dir: string) => void;
}) {
	const colors = useColorMode().colors;
	const tCore = useT();
	const live = Boolean(proxyStatus?.connected);
	const flashing = busy || Boolean(status?.running);
	const hasDevice = live || ports.length > 0 || flashing;
	const proxyName =
		proxyStatus?.name?.trim() || proxyStatus?.fqbn?.trim() || "";
	const stateLabel = !status
		? tCore("flash.thenFlash")
		: status.running
			? tCore("flash.flashing")
			: status.last
				? status.last.ok
					? tCore("flash.lastOk", { fqbn: status.last.fqbn })
					: tCore("flash.lastFailed", { fqbn: status.last.fqbn })
				: tCore("flash.thenFlash");
	return (
		<View style={{ flex: 1 }}>
			<DockStatusRow name={name} status={stateLabel} />
			<ScrollView nestedScrollEnabled style={{ flex: 1, marginTop: 4 }}>
				<Text style={{ color: colors.text, fontSize: 12, fontWeight: "700" }}>
					{tCore("flash.proxyTitle")}
				</Text>
				<View
					style={{
						flexDirection: "row",
						alignItems: "center",
						gap: 8,
						marginTop: 2,
					}}
				>
					<Text style={{ flex: 1, color: colors.muted, fontSize: 11 }}>
						{flashing
							? tCore("flash.takeMinute")
							: !hasDevice
								? portsChecked
									? tCore("flash.noDevice")
									: tCore("common.loading")
								: live
									? tCore("flash.firmata", {
											name: proxyName || tCore("debug.connected"),
										})
									: tCore("flash.usbArduino")}
					</Text>
					<TextButton
						label={
							flashing
								? tCore("flash.flashing")
								: live
									? tCore("flash.reflashProxy")
									: tCore("flash.asProxy")
						}
						disabled={busy || !hasDevice}
						onPress={onFlashProxy}
					/>
				</View>
				<Text
					style={{
						color: colors.text,
						fontSize: 12,
						fontWeight: "700",
						marginTop: 8,
					}}
				>
					{tCore("flash.arduinoFlash")}
				</Text>
				{!projectRepo ? (
					<Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
						{tCore("flash.selectProject")}
					</Text>
				) : sketches.length === 0 ? (
					<Text style={{ color: colors.muted, fontSize: 11, marginTop: 2 }}>
						{tCore("flash.noSketches")}
					</Text>
				) : (
					sketches.map((sketch) => (
						<View
							key={sketch.dir}
							style={{
								flexDirection: "row",
								alignItems: "center",
								gap: 8,
								marginTop: 4,
							}}
						>
							<Text
								style={{ flex: 1, color: colors.text, fontSize: 12 }}
								numberOfLines={1}
							>
								{sketch.name}
							</Text>
							<TextButton
								label={
									flashing ? tCore("flash.flashing") : tCore("flash.flash")
								}
								disabled={busy}
								onPress={() => onFlashSketch(sketch.dir)}
							/>
						</View>
					))
				)}
				{error ? <ErrorText>{translateError(tCore, error)}</ErrorText> : null}
			</ScrollView>
		</View>
	);
}

function DeckDock({ isEasy }: { isEasy: boolean }) {
	const colors = useColorMode().colors;
	const insets = useSafeAreaInsets();
	const { height: windowHeight } = useWindowDimensions();
	const t = useDeckT();
	const tCore = useT();
	const router = useRouter();
	const { uuid, setUuid } = useBoardSelection();
	const [pairedBoards, setPairedBoards] = useState<BoardView[]>([]);
	const [pickerOpen, setPickerOpen] = useState(false);
	const auth = useAuth();
	const [height, setHeight] = useState(DOCK_DEFAULT);
	const [tab, setTab] = useState<DockTab>("console");
	const [collapsed, setCollapsed] = useState(false);

	useEffect(() => {
		const subscription = DeviceEventEmitter.addListener(
			"gpio-ui-dock",
			(payload: unknown) => {
				const next =
					payload && typeof payload === "object"
						? (payload as { tab?: unknown }).tab
						: undefined;
				if (
					next === "console" ||
					next === "gpio" ||
					next === "flash" ||
					next === "problems" ||
					next === "actions"
				) {
					setTab(next);
					setCollapsed(false);
				}
			},
		);
		return () => subscription.remove();
	}, []);
	const [gpioHeader, setGpioHeader] = useState<GpioSnapshot | null>(null);
	const [gpioProxy, setGpioProxy] = useState<GpioSnapshot | null>(null);
	const [proxyStatus, setProxyStatus] = useState<ArduinoProxyStatus | null>(
		null,
	);
	const [flashStatus, setFlashStatus] = useState<FlashStatus | null>(null);
	const [sketches, setSketches] = useState<BoardSketch[]>([]);
	const [ports, setPorts] = useState<FlashPort[]>([]);
	const [portsChecked, setPortsChecked] = useState(false);
	const [projectRepo, setProjectRepo] = useState("");
	const [flashBusy, setFlashBusy] = useState(false);
	const [proxyBusy, setProxyBusy] = useState(false);
	const [flashError, setFlashError] = useState("");
	const dragStart = useRef(DOCK_DEFAULT);
	const currentHeight = useRef(DOCK_DEFAULT);
	const lastTap = useRef(0);
	const touch = useRef({ t: 0, dragging: false });

	const onGpioSnapshot = useCallback((snapshot: GpioSnapshot) => {
		if (snapshot.target === "arduino-proxy") {
			setGpioProxy(snapshot);
		} else {
			setGpioHeader(snapshot);
		}
	}, []);
	const onFlashStatus = useCallback(
		(status: FlashStatus) => setFlashStatus(status),
		[],
	);
	const onProxyStatus = useCallback(
		(status: ArduinoProxyStatus) => setProxyStatus(status),
		[],
	);
	const serial = useConsoleTunnel(uuid, auth.token);
	const gpioTunnel = useGpioTunnel(uuid, auth.token, onGpioSnapshot);
	useLiveHub(uuid, auth.token, {
		onFlash: onFlashStatus,
		onArduinoProxy: onProxyStatus,
	});
	const gpioRefreshRef = useRef(gpioTunnel.refresh);
	gpioRefreshRef.current = gpioTunnel.refresh;

	useEffect(() => {
		setGpioHeader(null);
		setGpioProxy(null);
		setProxyStatus(null);
		setFlashStatus(null);
		setPorts([]);
		setPortsChecked(false);
		const selected = uuid.trim();
		if (selected && auth.token) {
			gpioRefreshRef.current();
			gpioRefreshRef.current("arduino-proxy");
			void loadFlash(auth.token, selected).then(
				(status) => setFlashStatus(status),
				() => undefined,
			);
			void loadArduinoProxy(auth.token, selected).then(
				(status) => setProxyStatus(status),
				() => undefined,
			);
		}
	}, [uuid, auth.token]);

	useEffect(() => {
		if (tab !== "flash" || !uuid.trim() || !auth.token) {
			return;
		}
		let cancelled = false;
		const selected = uuid.trim();
		const token = auth.token;
		void storageGet(PROJECT_STORAGE_KEY).then((stored) => {
			if (cancelled) {
				return;
			}
			const repo = (stored ?? "").split("/").pop()?.trim() ?? "";
			setProjectRepo(repo);
			if (!repo) {
				setSketches([]);
				return;
			}
			void loadFlashSketches(token, selected).then(
				(result) => {
					if (!cancelled) {
						setSketches(
							result.sketches.filter(
								(sketch) =>
									sketch.project === repo || sketch.project === stored,
							),
						);
					}
				},
				() => {
					if (!cancelled) {
						setSketches([]);
					}
				},
			);
		});
		setPortsChecked(false);
		void loadFlashPorts(token, selected).then(
			(result) => {
				if (!cancelled) {
					setPorts(result.ports);
					setPortsChecked(true);
				}
			},
			() => {
				if (!cancelled) {
					setPorts([]);
					setPortsChecked(true);
				}
			},
		);
		return () => {
			cancelled = true;
		};
	}, [tab, uuid, auth.token]);

	const flashSketch = useCallback(
		(dir: string) => {
			const token = auth.token;
			const selected = uuid.trim();
			const target = pickMobileFlashTarget(ports, proxyStatus);
			if (!token || !selected || !target.fqbn) {
				setFlashError(tCore("flash.selectArduinoFirst"));
				return;
			}
			setFlashBusy(true);
			setFlashError("");
			void startFlash(token, {
				uuid: selected,
				fqbn: target.fqbn,
				dir,
				port: target.port || undefined,
			})
				.then(() => undefined)
				.catch((caught) => {
					setFlashError(
						caught instanceof Error ? caught.message : "request failed",
					);
				})
				.finally(() => setFlashBusy(false));
		},
		[auth.token, uuid, ports, proxyStatus, tCore],
	);

	const flashProxyFirmware = useCallback(() => {
		const token = auth.token;
		const selected = uuid.trim();
		if (!token || !selected) {
			return;
		}
		const target = pickMobileFlashTarget(ports, proxyStatus);
		if (!target.fqbn) {
			setFlashError(tCore("flash.selectArduinoFirst"));
			return;
		}
		const fqbn = target.fqbn;
		setProxyBusy(true);
		setFlashError("");
		void startFlashProxy(token, {
			uuid: selected,
			fqbn,
			port: target.port || ports[0]?.address || undefined,
		})
			.then(() => undefined)
			.catch((caught) => {
				setFlashError(
					caught instanceof Error ? caught.message : "request failed",
				);
			})
			.finally(() => setProxyBusy(false));
	}, [auth.token, uuid, ports, proxyStatus, tCore]);

	useEffect(() => {
		void storageGet(DOCK_STORAGE_KEY).then((stored) => {
			if (stored === null || stored.trim() === "") return;
			const parsed = Number(stored);
			if (Number.isFinite(parsed)) {
				const next = Math.max(DOCK_MIN, Math.min(DOCK_MAX, parsed));
				currentHeight.current = next;
				setHeight(next);
			}
		});
		void storageGet(DOCK_COLLAPSED_KEY).then((stored) => {
			if (stored === "1") setCollapsed(true);
		});
	}, []);

	useEffect(() => {
		if (isEasy && tab === "problems") setTab("console");
	}, [isEasy, tab]);

	useEffect(() => {
		if (!auth.token) {
			setPairedBoards([]);
			return;
		}
		void listDeviceStatus(auth.token).then(
			(result) => setPairedBoards(result.devices),
			() => undefined,
		);
	}, [auth.token, uuid]);

	const updateHeight = useCallback((next: number) => {
		const value = Math.max(DOCK_MIN, Math.min(DOCK_MAX, Math.round(next)));
		currentHeight.current = value;
		setHeight(value);
		void storageSet(DOCK_STORAGE_KEY, String(value));
	}, []);
	const setDockCollapsed = useCallback((next: boolean) => {
		setCollapsed(next);
		void storageSet(DOCK_COLLAPSED_KEY, next ? "1" : "0");
	}, []);
	const pan = useMemo(
		() =>
			PanResponder.create({
				onStartShouldSetPanResponder: () => true,
				onPanResponderGrant: () => {
					dragStart.current = currentHeight.current;
					touch.current = { t: Date.now(), dragging: false };
				},
				onPanResponderMove: (_event, gesture) => {
					if (!touch.current.dragging) {
						if (Math.abs(gesture.dy) <= 4) return;
						touch.current.dragging = true;
						if (collapsed) setDockCollapsed(false);
					}
					const next = Math.max(
						DOCK_MIN,
						Math.min(DOCK_MAX, dragStart.current - gesture.dy),
					);
					currentHeight.current = next;
					setHeight(next);
				},
				onPanResponderRelease: (_event, gesture) => {
					if (
						!touch.current.dragging &&
						Date.now() - touch.current.t < 500 &&
						Math.abs(gesture.dy) <= 4
					) {
						const now = Date.now();
						if (now - lastTap.current < 300) {
							setDockCollapsed(false);
							updateHeight(DOCK_DEFAULT);
						}
						lastTap.current = now;
						return;
					}
					updateHeight(currentHeight.current);
				},
				onPanResponderTerminate: () => updateHeight(currentHeight.current),
			}),
		[updateHeight, collapsed, setDockCollapsed],
	);
	const tabs: DockTab[] = isEasy
		? ["console", "gpio", "flash", "actions"]
		: ["console", "gpio", "flash", "problems", "actions"];
	const helpKey = `deck.${tab}Help` as DeckKey;
	const currentBoard = pairedBoards.find((board) => board.device.uuid === uuid);
	const boardLabel = currentBoard
		? isEasy
			? deviceDisplayName(currentBoard.device) === currentBoard.device.uuid
				? tCore("deck.status.unnamed")
				: deviceDisplayName(currentBoard.device)
			: deviceDisplayName(currentBoard.device)
		: uuid.trim()
			? isEasy
				? tCore("deck.status.unnamed")
				: uuid.trim().slice(0, 8)
			: tCore("deck.status.noBoard");

	return (
		<View
			style={{
				...(collapsed ? undefined : { height }),
				backgroundColor: colors.surface,
				borderTopWidth: 1,
				borderTopColor: colors.border,
			}}
		>
			<View
				{...pan.panHandlers}
				accessibilityRole="adjustable"
				accessibilityLabel={t("deck.resizeDock")}
				onAccessibilityAction={(event) => {
					if (event.nativeEvent.actionName === "increment")
						updateHeight(height + 32);
					if (event.nativeEvent.actionName === "decrement")
						updateHeight(height - 32);
				}}
				accessibilityActions={[
					{ name: "increment", label: t("deck.growDock") },
					{ name: "decrement", label: t("deck.shrinkDock") },
				]}
				style={{ height: 24, alignItems: "center", justifyContent: "center" }}
			>
				<View
					style={{
						width: 42,
						height: 4,
						borderRadius: 2,
						backgroundColor: colors.border,
					}}
				/>
			</View>
			<View style={{ flexDirection: "row", paddingHorizontal: 4 }}>
				{tabs.map((item) => (
					<Pressable
						key={item}
						onPress={() => {
							setTab(item);
							if (collapsed) setDockCollapsed(false);
						}}
						style={{
							flex: 1,
							alignItems: "center",
							paddingVertical: 7,
							borderBottomWidth: 2,
							borderBottomColor: tab === item ? colors.primary : "transparent",
						}}
					>
						<Text
							style={{
								color: tab === item ? colors.primary : colors.muted,
								fontSize: 12,
								fontWeight: "700",
							}}
						>
							{t(`deck.${item}` as DeckKey)}
						</Text>
					</Pressable>
				))}
				<Pressable
					onPress={() => setPickerOpen(true)}
					accessibilityRole="button"
					accessibilityLabel={tCore("deck.dock.connectBoard")}
					style={{ justifyContent: "center", paddingHorizontal: 8 }}
				>
					<Text
						numberOfLines={1}
						style={{
							color: colors.primary,
							fontSize: 12,
							fontWeight: "700",
							maxWidth: 110,
						}}
					>
						{boardLabel}
					</Text>
				</Pressable>
				<Pressable
					onPress={() => setDockCollapsed(!collapsed)}
					accessibilityRole="button"
					accessibilityLabel={t(
						collapsed ? "deck.expandDock" : "deck.collapseDock",
					)}
					hitSlop={8}
					style={{
						alignItems: "center",
						justifyContent: "center",
						paddingHorizontal: 10,
						paddingVertical: 7,
					}}
				>
					<MaterialIcons
						name={collapsed ? "keyboard-arrow-up" : "keyboard-arrow-down"}
						size={20}
						color={colors.muted}
					/>
				</Pressable>
			</View>
			{!collapsed && height > 96 ? (
				<View style={{ flex: 1, paddingHorizontal: 14, paddingTop: 8 }}>
					{tab === "problems" ? (
						<Text style={{ color: colors.muted }}>{t(helpKey)}</Text>
					) : !uuid.trim() ? (
						<View style={{ gap: 8 }}>
							<Text style={{ color: colors.muted }}>{t(helpKey)}</Text>
							<PrimaryButton
								label={t("deck.selectBoard")}
								onPress={() => router.navigate("/")}
							/>
						</View>
					) : tab === "console" ? (
						<DockConsole
							status={serial.status}
							hostLog={serial.snapshot.host.log}
							usbLog={serial.snapshot.usb.log}
							name={boardLabel}
							onClear={serial.clear}
						/>
					) : tab === "actions" ? (
						<DockActions uuid={uuid} token={auth.token} />
					) : tab === "gpio" ? (
						<DockGpio
							status={gpioTunnel.status}
							header={gpioHeader}
							proxy={gpioProxy}
							proxyStatus={proxyStatus}
							name={boardLabel}
						/>
					) : (
						<DockFlash
							status={flashStatus}
							proxyStatus={proxyStatus}
							ports={ports}
							portsChecked={portsChecked}
							name={boardLabel}
							projectRepo={projectRepo}
							sketches={sketches}
							busy={flashBusy || proxyBusy || Boolean(flashStatus?.running)}
							error={flashError}
							onFlashProxy={flashProxyFirmware}
							onFlashSketch={flashSketch}
						/>
					)}
				</View>
			) : null}
			<Modal
				visible={pickerOpen}
				transparent
				animationType="fade"
				statusBarTranslucent
				navigationBarTranslucent
				onRequestClose={() => setPickerOpen(false)}
			>
				<View style={{ flex: 1, justifyContent: "flex-end" }}>
					<Pressable
						accessibilityRole="button"
						accessibilityLabel={t("deck.close")}
						onPress={() => setPickerOpen(false)}
						style={{
							position: "absolute",
							top: 0,
							right: 0,
							bottom: 0,
							left: 0,
							backgroundColor: "rgba(0,0,0,0.4)",
						}}
					/>
					<View
						style={{
							maxHeight: Math.min(320, Math.round(windowHeight * 0.45)),
							marginHorizontal: 12,
							marginBottom: Math.max(insets.bottom, 12),
							backgroundColor: colors.surface,
							borderWidth: 1,
							borderColor: colors.border,
							borderRadius: 12,
							overflow: "hidden",
						}}
					>
						<Text
							style={{
								color: colors.text,
								fontWeight: "700",
								paddingHorizontal: 16,
								paddingTop: 12,
								paddingBottom: 4,
							}}
						>
							{tCore("deck.dock.connectBoard")}
						</Text>
						<ScrollView
							keyboardShouldPersistTaps="handled"
							style={{
								maxHeight: Math.min(320, Math.round(windowHeight * 0.45)) - 40,
							}}
						>
							{pairedBoards.length === 0 ? (
								<Text style={{ color: colors.muted, padding: 16 }}>
									{tCore("devices.noBoardsYetBle")}
								</Text>
							) : (
								pairedBoards.map((board) => {
									const selected = board.device.uuid === uuid;
									return (
										<Pressable
											key={board.device.uuid}
											accessibilityRole="button"
											accessibilityState={{ selected }}
											onPress={() => {
												setUuid(board.device.uuid);
												setTab("console");
												setDockCollapsed(false);
												setPickerOpen(false);
											}}
											style={{
												paddingHorizontal: 16,
												paddingVertical: 12,
												backgroundColor: selected
													? colors.chipBg
													: "transparent",
											}}
										>
											<Text
												style={{
													color: selected ? colors.primary : colors.text,
													fontWeight: selected ? "700" : "400",
												}}
											>
												{isEasy &&
												deviceDisplayName(board.device) === board.device.uuid
													? tCore("deck.status.unnamed")
													: deviceDisplayName(board.device)}
											</Text>
										</Pressable>
									);
								})
							)}
						</ScrollView>
					</View>
				</View>
			</Modal>
		</View>
	);
}
