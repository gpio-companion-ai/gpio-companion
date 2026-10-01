import Button from "@shpaw415/mui-lite/Button";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import IconButton from "@shpaw415/mui-lite/IconButton";
import Snackbar from "@shpaw415/mui-lite/Snackbar";
import Typography from "@shpaw415/mui-lite/Typography";
import type { UiModalCommand } from "gpio-companion-ui";
import {
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useEffect,
	useRef,
	useState,
} from "react";
import logo from "../../../../logo/logo.png";
import { useUserBoards } from "../hooks/useApiCache";
import { useBoardSelection } from "../hooks/useBoardSelection";
import { useConsoleTunnel } from "../hooks/useConsoleTunnel";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { useUiSocket } from "../hooks/useUiSocket";
import {
	type DeviceTabId,
	deviceTabs,
	isAllowedDeviceTab,
} from "../lib/dashboard-mode";
import { useT } from "../locale";
import DockBody from "./DockBody";
import type { DockTab } from "../hooks/useBoardSelection";

export type DeckSection = "project" | "devices" | "profile";
type RailPane = "work" | "fleet" | "code" | "you";
type FocusRegion = "primary" | "secondary";
type ProfileSection = "account" | "language" | "keys" | "credits" | "address";

function DeckIcon({
	name,
}: {
	name: RailPane | "menu" | "search" | "theme" | "collapse" | "expand";
}) {
	const paths = {
		work: "M4 7h16v12H4zM9 7V4h6v3",
		fleet: "M5 5h14v14H5zM8 9h8M8 13h5",
		code: "M7 4h10v4h3v12H4V8h3zM9 12h6M9 16h4",
		you: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 21a7 7 0 0 1 14 0",
		menu: "M4 7h16M4 12h16M4 17h16",
		collapse: "M15 6 9 12l6 6",
		expand: "M9 6l6 6-6 6",
		search: "M11 18a7 7 0 1 1 0-14 7 7 0 0 1 0 14zm5-2 4 4",
		theme:
			"M12 3v2m0 14v2M3 12h2m14 0h2M5.6 5.6 7 7m10 10 1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z",
	};
	return (
		<svg viewBox="0 0 24 24" aria-hidden="true">
			<path d={paths[name]} />
		</svg>
	);
}

function boardName(
	board: {
		device: { uuid: string; label?: string };
		status: { model?: string } | null;
	},
	expert: boolean,
	unnamed: string,
) {
	const label = board.device.label?.trim();
	if (label && label !== board.device.uuid) {
		return label;
	}
	if (board.status?.model) {
		return board.status.model;
	}
	return expert ? board.device.uuid.slice(0, 8) : unnamed;
}

function readDockHeight() {
	const stored = Number.parseInt(localStorage.getItem("b6-dockH") ?? "", 10);
	return Number.isFinite(stored) ? Math.min(480, Math.max(64, stored)) : 150;
}

function readContextOpen() {
	return localStorage.getItem("b6-contextOpen") !== "0";
}

export default function DeckShell({
	section,
	deviceTab,
	admin,
	isDark,
	onNavigate,
	onDeviceTab,
	onToggleTheme,
	children,
}: {
	section: DeckSection;
	deviceTab: DeviceTabId;
	admin: boolean;
	isDark: boolean;
	onNavigate: (section: DeckSection) => void;
	onDeviceTab: (tab: DeviceTabId) => void;
	onToggleTheme: () => void;
	children: ReactNode;
}) {
	const t = useT();
	const { mode, isEasy, toggleMode } = useDashboardMode();
	const { uuid, setUuid, dockTab, setDockTab, dockOpen, setDockOpen } =
		useBoardSelection();
	const { boards } = useUserBoards();
	const tunnel = useConsoleTunnel(section === "profile" ? "" : uuid);
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [contextOpen, setContextOpen] = useState(readContextOpen);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [focus, setFocus] = useState<FocusRegion>("primary");
	const [dockHeight, setDockHeight] = useState(readDockHeight);
	const [profileSection, setProfileSection] =
		useState<ProfileSection>("account");
	const [uiToast, setUiToast] = useState<string | null>(null);
	const [uiModal, setUiModal] = useState<UiModalCommand | null>(null);
	const uiToastTimer = useRef(0);

	const uiSocket = useUiSocket({
		surface: "desktop",
		enabled: Boolean(uuid),
		uuid,
		isFocused: () => document.hasFocus(),
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
						onNavigate("project");
						return;
					}
					if (target === "devices") {
						onNavigate("devices");
						onDeviceTab("overview");
						return;
					}
					if (
						target === "profile" ||
						target === "keys" ||
						target === "credits" ||
						target === "github"
					) {
						onNavigate("profile");
						return;
					}
					onNavigate("devices");
					onDeviceTab(target);
					return;
				}
				case "dock":
					setDockOpen(true);
					setDockTab(command.tab);
					return;
				case "palette":
					setPaletteOpen(command.open);
					return;
				case "toast":
					setUiToast(command.text);
					window.clearTimeout(uiToastTimer.current);
					uiToastTimer.current = window.setTimeout(
						() => setUiToast(null),
						4000,
					);
					return;
				case "modal":
					setUiModal(command);
					return;
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

	useEffect(() => {
		function onAddress() {
			setProfileSection("address");
		}
		window.addEventListener("gpio-profile-address", onAddress);
		return () => {
			window.removeEventListener("gpio-profile-address", onAddress);
		};
	}, []);
	const paletteInput = useRef<HTMLInputElement>(null);

	const pane: RailPane =
		section === "project"
			? "work"
			: section === "profile"
				? "you"
				: deviceTab === "code"
					? "code"
					: "fleet";
	const navigateRail = (next: RailPane) => {
		if (next === "work") onNavigate("project");
		if (next === "fleet") {
			onNavigate("devices");
			onDeviceTab("overview");
		}
		if (next === "code") {
			onNavigate("devices");
			onDeviceTab("code");
		}
		if (next === "you") onNavigate("profile");
		setDrawerOpen(false);
	};

	const commands = [
		{ label: t("deck.command.work"), run: () => navigateRail("work") },
		{ label: t("deck.command.fleet"), run: () => navigateRail("fleet") },
		{ label: t("nav.code"), run: () => navigateRail("code") },
		{ label: t("deck.command.you"), run: () => navigateRail("you") },
		...deviceTabs(mode, admin).map((item) => ({
			label: t(item.labelKey),
			run: () => {
				onNavigate("devices");
				onDeviceTab(item.id);
			},
		})),
		{
			label: t("project.run"),
			run: () => {
				setDockTab("console");
				setDockOpen(true);
			},
		},
		{
			label: t("flash.flash"),
			run: () => {
				setDockTab("flash");
				setDockOpen(true);
			},
		},
		{
			label: t("verify.verify"),
			run: () => {
				setDockTab(isEasy ? "flash" : "problems");
				setDockOpen(true);
			},
		},
		{
			label: t("project.saveToGithub"),
			run: () => navigateRail("work"),
		},
		{
			label: t("credits.add"),
			run: () => navigateRail("you"),
		},
		{ label: t("deck.command.mode"), run: toggleMode },
		{ label: t("deck.command.theme"), run: onToggleTheme },
	].filter((command, index, all) => {
		if (all.findIndex((other) => other.label === command.label) !== index) {
			return false;
		}
		return command.label
			.toLocaleLowerCase()
			.includes(query.trim().toLocaleLowerCase());
	});

	useEffect(() => {
		const onKey = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen(true);
				setQuery("");
				window.setTimeout(() => paletteInput.current?.focus());
				return;
			}
			if (event.key === "Escape") setPaletteOpen(false);
			if ((event.metaKey || event.ctrlKey) && event.key === "1") {
				event.preventDefault();
				setFocus("primary");
			}
			if ((event.metaKey || event.ctrlKey) && event.key === "2") {
				event.preventDefault();
				setFocus("secondary");
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, []);

	useEffect(() => {
		if (!isAllowedDeviceTab(mode, admin, deviceTab)) onDeviceTab("overview");
	}, [admin, deviceTab, mode, onDeviceTab]);

	useEffect(() => {
		if (isEasy && dockTab === "problems") setDockTab("flash");
	}, [dockTab, isEasy, setDockTab]);

	const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
		event.currentTarget.setPointerCapture(event.pointerId);
		const startY = event.clientY;
		const startHeight = dockHeight;
		const onMove = (move: PointerEvent) =>
			setDockHeight(
				Math.min(480, Math.max(64, startHeight + startY - move.clientY)),
			);
		const onUp = () => {
			window.removeEventListener("pointermove", onMove);
			window.removeEventListener("pointerup", onUp);
			setDockHeight((height) => {
				localStorage.setItem("b6-dockH", String(Math.round(height)));
				return height;
			});
		};
		window.addEventListener("pointermove", onMove);
		window.addEventListener("pointerup", onUp);
	};

	const sidebarTitle =
		pane === "work"
			? t("deck.context.work")
			: pane === "you"
				? t("deck.context.you")
				: t("deck.context.fleet");
	const selected = boards.find((board) => board.device.uuid === uuid);

	function writeContextOpen(open: boolean) {
		setContextOpen(open);
		localStorage.setItem("b6-contextOpen", open ? "1" : "0");
	}

	return (
		<div className={`b6-shell${contextOpen ? "" : " is-context-collapsed"}`}>
			<header className="b6-topbar">
				<IconButton
					className="b6-menu"
					size="small"
					aria-label={t("deck.action.openNavigation")}
					onClick={() => setDrawerOpen(true)}
				>
					<DeckIcon name="menu" />
				</IconButton>
				<div className="b6-brand">
					<img src={logo} alt="" />
					<strong>gpio-companion</strong>
				</div>
				<div className="b6-top-actions">
					<Button
						size="small"
						variant="text"
						onClick={() => {
							setPaletteOpen(true);
							setQuery("");
							window.setTimeout(() => paletteInput.current?.focus());
						}}
					>
						<DeckIcon name="search" /> <span>{t("deck.command.shortcut")}</span>
					</Button>
					<Button size="small" variant="text" onClick={toggleMode}>
						{isEasy ? t("mode.easy") : t("mode.expert")}
					</Button>
					<IconButton
						size="small"
						aria-label={
							isDark ? t("theme.switchToLight") : t("theme.switchToDark")
						}
						onClick={onToggleTheme}
					>
						<DeckIcon name="theme" />
					</IconButton>
				</div>
			</header>

			<nav className="b6-rail" aria-label={t("deck.rail.label")}>
				{(["work", "fleet", "code", "you"] as const).map((item) => (
					<button
						key={item}
						type="button"
						className={pane === item ? "is-active" : ""}
						onClick={() => navigateRail(item)}
					>
						<DeckIcon name={item} />
						<span>{t(`deck.rail.${item}`)}</span>
					</button>
				))}
				<button
					type="button"
					className="b6-rail-expand"
					aria-label={t("deck.action.expandContext")}
					onClick={() => writeContextOpen(true)}
				>
					<DeckIcon name="expand" />
				</button>
			</nav>
			{drawerOpen ? (
				<button
					type="button"
					className="b6-scrim"
					aria-label={t("deck.action.closeNavigation")}
					onClick={() => setDrawerOpen(false)}
				/>
			) : null}
			<aside className={`b6-sidebar ${drawerOpen ? "is-open" : ""}`}>
				<div className="b6-mobile-rail">
					{(["work", "fleet", "code", "you"] as const).map((item) => (
						<button
							key={item}
							type="button"
							className={pane === item ? "is-active" : ""}
							onClick={() => navigateRail(item)}
						>
							<DeckIcon name={item} />
							{t(`deck.rail.${item}`)}
						</button>
					))}
				</div>
				<div className="b6-sidebar-heading">
					<Typography variant="overline">{sidebarTitle}</Typography>
					<IconButton
						className="b6-context-collapse"
						size="small"
						aria-label={t("deck.action.collapseContext")}
						onClick={() => writeContextOpen(false)}
					>
						<DeckIcon name="collapse" />
					</IconButton>
				</div>
				<div className="b6-sidebar-items">
					{pane === "work" ? (
						<button
							type="button"
							className="is-active"
							onClick={() => setDrawerOpen(false)}
						>
							{t("nav.project")}
						</button>
					) : null}
					{pane === "fleet" || pane === "code"
						? deviceTabs(mode, admin).map((item) => (
								<button
									type="button"
									key={item.id}
									className={deviceTab === item.id ? "is-active" : ""}
									onClick={() => {
										onNavigate("devices");
										onDeviceTab(item.id);
										setDrawerOpen(false);
									}}
								>
									{t(item.labelKey)}
								</button>
							))
						: null}
					{pane === "you"
						? (
								["account", "language", "keys", "credits", "address"] as const
							).map((item) => (
								<button
									type="button"
									key={item}
									className={profileSection === item ? "is-active" : ""}
									onClick={() => {
										setProfileSection(item);
										setDrawerOpen(false);
										document.getElementById(`profile-${item}`)?.scrollIntoView({
											behavior: "smooth",
											block: "start",
										});
									}}
								>
									{item === "keys"
										? t("nav.github")
										: item === "language"
											? t("language.title")
											: item === "address"
												? t("nav.address")
												: t(`nav.${item}`)}
								</button>
							))
						: null}
				</div>
			</aside>

			<main className="b6-stage">
				<section
					className={`b6-primary ${focus === "primary" ? "is-focused" : ""}`}
					tabIndex={-1}
					aria-label={t("deck.focus.primary")}
					onFocus={() => setFocus("primary")}
				>
					<div
						className={`b6-screen workbench-bg${section === "devices" && deviceTab === "code" ? " is-fill" : ""}`}
					>
						{children}
					</div>
				</section>
				<aside
					className={`b6-context ${focus === "secondary" ? "is-focused" : ""}`}
					tabIndex={-1}
					aria-label={t("deck.focus.secondary")}
					onFocus={() => setFocus("secondary")}
				>
					<Typography variant="caption" color="secondary">
						{selected
							? selected.status
								? t("deck.status.online")
								: t("deck.status.offline")
							: t("deck.secondary.empty")}
					</Typography>
					<Typography variant="body2" noWrap>
						{selected
							? boardName(selected, !isEasy, t("deck.status.unnamed"))
							: ""}
					</Typography>
				</aside>
			</main>

			{section === "profile" ? null : (
				<section
					className={`b6-dock ${dockOpen ? "" : "is-collapsed"}`}
					style={{ height: dockOpen ? dockHeight : 36 }}
				>
					<button
						type="button"
						role="slider"
						className="b6-dock-resizer"
						aria-label={t("deck.dock.resize")}
						aria-valuemin={64}
						aria-valuemax={480}
						aria-valuenow={dockHeight}
						aria-orientation="vertical"
						onPointerDown={startResize}
						onDoubleClick={() => {
							setDockHeight(150);
							localStorage.setItem("b6-dockH", "150");
						}}
						onKeyDown={(event) => {
							const step =
								event.key === "ArrowUp"
									? 24
									: event.key === "ArrowDown"
										? -24
										: 0;
							if (!step && event.key !== "Home") {
								return;
							}
							event.preventDefault();
							const next =
								event.key === "Home"
									? 150
									: Math.min(480, Math.max(64, dockHeight + step));
							setDockHeight(next);
							localStorage.setItem("b6-dockH", String(next));
						}}
					/>
					<div className="b6-dock-tabs">
						{(
							[
								"console",
								"gpio",
								"flash",
								"actions",
								...(isEasy ? [] : ["problems"]),
							] as DockTab[]
						).map((item) => (
							<button
								type="button"
								key={item}
								className={dockOpen && dockTab === item ? "is-active" : ""}
								onClick={() => {
									setDockTab(item);
									setDockOpen(true);
								}}
							>
								{t(`deck.dock.${item}`)}
							</button>
						))}
						<label className="b6-dock-board">
							<select
								aria-label={t("deck.dock.connectBoard")}
								value={
									boards.some((board) => board.device.uuid === uuid) ? uuid : ""
								}
								disabled={boards.length === 0}
								onChange={(event) => {
									setUuid(event.target.value);
									setDockTab("console");
									setDockOpen(true);
								}}
							>
								{boards.some((board) => board.device.uuid === uuid) ? null : (
									<option value="">{t("deck.dock.connectBoard")}</option>
								)}
								{boards.map((board) => (
									<option key={board.device.uuid} value={board.device.uuid}>
										{boardName(board, !isEasy, t("deck.status.unnamed"))}
									</option>
								))}
							</select>
						</label>
						<button type="button" onClick={() => setDockOpen(!dockOpen)}>
							{dockOpen ? t("deck.dock.collapse") : t("deck.dock.expand")}
						</button>
					</div>
					<div className="b6-dock-body">
						{dockOpen ? (
							<DockBody
								tab={dockTab}
								uuid={uuid}
								log={tunnel.snapshot.host.log}
								status={tunnel.status}
								clear={tunnel.clear}
								connected={Boolean(selected?.status)}
							/>
						) : null}
					</div>
				</section>
			)}
			<footer className="b6-status">
				<span>
					{selected
						? selected.status
							? t("deck.status.online")
							: t("deck.status.offline")
						: t("deck.status.ready")}
				</span>
				<span>
					{selected
						? boardName(selected, !isEasy, t("deck.status.unnamed"))
						: t("deck.status.noBoard")}
				</span>
				<span>
					{tunnel.status === "live"
						? t("deck.status.consoleLive")
						: t("deck.status.consoleDown")}
				</span>
			</footer>

			{paletteOpen ? (
				<div className="b6-palette-backdrop">
					<button
						type="button"
						className="b6-palette-scrim"
						aria-label={t("deck.command.close")}
						onClick={() => setPaletteOpen(false)}
					/>
					<div
						className="b6-palette"
						role="dialog"
						aria-label={t("deck.command.title")}
					>
						<input
							ref={paletteInput}
							value={query}
							placeholder={t("deck.command.placeholder")}
							onChange={(event) => setQuery(event.target.value)}
							onKeyDown={(event) => {
								if (event.key === "Enter" && commands[0]) {
									commands[0].run();
									setPaletteOpen(false);
								}
							}}
						/>
						{commands.length ? (
							commands.map((command) => (
								<button
									type="button"
									key={command.label}
									onClick={() => {
										command.run();
										setPaletteOpen(false);
									}}
								>
									{command.label}
								</button>
							))
						) : (
							<p>{t("deck.command.empty")}</p>
						)}
					</div>
				</div>
			) : null}

			<Snackbar
				open={Boolean(uiToast)}
				autoHideDuration={4000}
				onClose={() => setUiToast(null)}
				message={uiToast ?? ""}
				position="top-center"
			/>

			<Dialog
				open={Boolean(uiModal)}
				onClose={() => closeUiModal("dismiss")}
				fullWidth
				scroll="paper"
				sx={{ zIndex: 1400 }}
				slotProps={{ paper: { className: "max-w-xl w-full" } }}
			>
				<DialogTitle>{uiModal?.title ?? ""}</DialogTitle>
				<DialogContent>
					<Typography sx={{ whiteSpace: "pre-wrap" }}>
						{uiModal?.body ?? ""}
					</Typography>
				</DialogContent>
				<DialogActions>
					{(uiModal?.buttons ?? []).map((label) => (
						<Button
							key={label}
							type="button"
							variant="text"
							onClick={() => closeUiModal(label)}
						>
							{label}
						</Button>
					))}
					<Button
						type="button"
						variant="text"
						onClick={() => closeUiModal("dismiss")}
					>
						{t("deck.ui.dismiss")}
					</Button>
				</DialogActions>
			</Dialog>
		</div>
	);
}
