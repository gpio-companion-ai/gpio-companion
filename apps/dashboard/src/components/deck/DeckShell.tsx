import AccountCircleIcon from "@material-design-icons/svg/filled/account_circle.svg";
import BoltIcon from "@material-design-icons/svg/filled/bolt.svg";
import BuildIcon from "@material-design-icons/svg/filled/build.svg";
import ChevronLeftIcon from "@material-design-icons/svg/filled/chevron_left.svg";
import ChevronRightIcon from "@material-design-icons/svg/filled/chevron_right.svg";
import CloseIcon from "@material-design-icons/svg/filled/close.svg";
import DarkModeIcon from "@material-design-icons/svg/filled/dark_mode.svg";
import FolderIcon from "@material-design-icons/svg/filled/folder.svg";
import LightModeIcon from "@material-design-icons/svg/filled/light_mode.svg";
import MemoryIcon from "@material-design-icons/svg/filled/memory.svg";
import MenuIcon from "@material-design-icons/svg/filled/menu.svg";
import SearchIcon from "@material-design-icons/svg/filled/search.svg";
import TerminalIcon from "@material-design-icons/svg/filled/terminal.svg";
import WarningIcon from "@material-design-icons/svg/filled/warning.svg";
import { navigate } from "@next/client";
import BottomNavigation, {
	BottomNavigationAction,
} from "@shpaw415/mui-lite/BottomNavigation";
import Button from "@shpaw415/mui-lite/Button";
import Dialog, {
	DialogActions,
	DialogContent,
	DialogTitle,
} from "@shpaw415/mui-lite/Dialog";
import IconButton from "@shpaw415/mui-lite/IconButton";
import Paper from "@shpaw415/mui-lite/Paper";
import Snackbar from "@shpaw415/mui-lite/Snackbar";
import type { UiModalCommand, UiNavigateTarget } from "gpio-companion";
import type {
	ComponentType,
	ReactNode,
	PointerEvent as ReactPointerEvent,
} from "react";
import { useEffect, useRef, useState } from "react";
import { useAuthSession } from "../../hooks/useAuth.ts";
import { useBoardSelection } from "../../hooks/useBoardSelection.tsx";
import { useColorMode } from "../../hooks/useColorMode.tsx";
import { useDashboardMode } from "../../hooks/useDashboardMode.tsx";
import { useT } from "../../hooks/useLocale.tsx";
import useMobile from "../../hooks/useMobile.ts";
import { usePathname } from "../../hooks/usePathname.tsx";
import { useUiSocket } from "../../hooks/useUiSocket.ts";
import {
	type BoardAction,
	type FleetBoard,
	type SidebarEntry,
	useWorkbench,
} from "../../hooks/useWorkbench.tsx";
import { isAdmin } from "../../lib/auth/role.ts";
import {
	deviceTabs,
	PROFILE_TABS,
	type SectionTab,
} from "../../lib/dashboard-mode.ts";
import DockBody from "./DockBody.tsx";

const DASHBOARD_BOTTOM_NAV_ID = "gpio-dashboard-bottom-nav";

type DeckTranslate = (key: `deck.${string}`) => string;
type FocusRegion = "primary" | "secondary";
type DockTab = "console" | "gpio" | "flash" | "problems";
type ContextLink = {
	href: string;
	labelKey: `deck.${string}`;
};

const DOCK_TABS: Array<[DockTab, ComponentType]> = [
	["console", TerminalIcon],
	["gpio", BoltIcon],
	["flash", BuildIcon],
	["problems", WarningIcon],
];

const UI_NAVIGATE_HREF: Record<UiNavigateTarget, string> = {
	project: "/project",
	code: "/devices/code",
	docs: "/devices/docs",
	devices: "/devices",
	pair: "/devices/pair",
	wifi: "/devices/wifi",
	keys: "/keys",
	requests: "/devices/notifications",
	debug: "/devices/debug",
	admin: "/devices/admin",
	profile: "/profile",
	github: "/profile/github",
	credits: "/profile/credits",
};

const DOCK_STORAGE_KEY = "b6-dockH";
const CONTEXT_STORAGE_KEY = "b6-contextOpen";
const DEFAULT_DOCK_HEIGHT = 150;

function sectionFor(pathname: string): "/project" | "/devices" | "/profile" {
	if (pathname.startsWith("/devices")) return "/devices";
	if (pathname.startsWith("/profile")) return "/profile";
	return "/project";
}

function selectedHref(pathname: string, links: ContextLink[]): string {
	return (
		[...links]
			.sort((a, b) => b.href.length - a.href.length)
			.find(
				(link) =>
					pathname === link.href || pathname.startsWith(`${link.href}/`),
			)?.href ??
		links[0]?.href ??
		""
	);
}

function publicBoardName(
	board: FleetBoard,
	expert: boolean,
	unnamed: string,
): string {
	if (board.label && board.label !== board.uuid) {
		return board.label;
	}
	if (board.model) {
		return board.model;
	}
	return expert ? board.uuid.slice(0, 8) : unnamed;
}

function focusPane(node: HTMLElement | null) {
	if (!node) {
		return;
	}
	const target = node.querySelector<HTMLElement>(
		"a, button, input, select, textarea, [tabindex='0']",
	);
	(target ?? node).focus();
}

function readDockHeight(): number {
	if (typeof window === "undefined") return DEFAULT_DOCK_HEIGHT;
	const raw = window.localStorage.getItem(DOCK_STORAGE_KEY);
	if (!raw) return DEFAULT_DOCK_HEIGHT;
	const stored = Number(raw);
	return Number.isFinite(stored)
		? Math.min(480, Math.max(64, stored))
		: DEFAULT_DOCK_HEIGHT;
}

function readContextOpen(): boolean {
	if (typeof window === "undefined") return true;
	return window.localStorage.getItem(CONTEXT_STORAGE_KEY) !== "0";
}

function deckLink(link: SectionTab): ContextLink {
	return {
		href: link.href,
		labelKey: `deck.link.${link.labelKey.slice("nav.".length)}`,
	};
}

export default function DeckShell({ children }: { children: ReactNode }) {
	const pathname = usePathname();
	const t = useT() as unknown as DeckTranslate;
	const tAny = t as unknown as (
		key: string,
		vars?: Record<string, string | number>,
	) => string;
	const session = useAuthSession();
	const { uuid: selectedBoardUuid, setUuid: selectBoard } = useBoardSelection();
	const mobile = useMobile();
	const { isDark, toggleMode: toggleTheme } = useColorMode();
	const { mode, setMode } = useDashboardMode();
	const [drawerOpen, setDrawerOpen] = useState(false);
	const [contextOpen, setContextOpen] = useState(readContextOpen);
	const [paletteOpen, setPaletteOpen] = useState(false);
	const [query, setQuery] = useState("");
	const [activeIndex, setActiveIndex] = useState(0);
	const [focusRegion, setFocusRegion] = useState<FocusRegion>("primary");
	const [dockHeight, setDockHeight] = useState(readDockHeight);
	const workbench = useWorkbench();
	const {
		boards,
		project,
		consoleStatus,
		requestAction,
		dockOpen,
		setDockOpen,
		dockTab,
		setDockTab,
		workSidebar,
		docsSidebar,
	} = workbench;
	const primaryRef = useRef<HTMLElement>(null);
	const secondaryRef = useRef<HTMLElement>(null);
	const paletteInputRef = useRef<HTMLInputElement>(null);
	const paletteTriggerRef = useRef<HTMLButtonElement>(null);
	const mobileDockInit = useRef(false);
	const dragRef = useRef<{ y: number; height: number } | null>(null);
	const section = sectionFor(pathname);
	const selectedBoard = boards.find(
		(board) => board.uuid === selectedBoardUuid,
	);
	const [uiToast, setUiToast] = useState<string | null>(null);
	const [uiModal, setUiModal] = useState<UiModalCommand | null>(null);
	const uiToastTimer = useRef(0);

	const uiSocket = useUiSocket({
		surface: "web",
		enabled: Boolean(session.data?.id && selectedBoardUuid),
		uuid: selectedBoardUuid,
		isFocused: () =>
			typeof document === "undefined" ||
			(document.visibilityState === "visible" && document.hasFocus()),
		onCommand: (command) => {
			switch (command.type) {
				case "navigate": {
					const href = UI_NAVIGATE_HREF[command.target];
					if (
						!href ||
						((command.target === "debug" || command.target === "admin") &&
							(mode !== "expert" || !admin))
					) {
						return;
					}
					navigate(href);
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

	const rail = [
		{ href: "/project", label: t("deck.rail.work"), icon: <FolderIcon /> },
		{ href: "/devices", label: t("deck.rail.fleet"), icon: <MemoryIcon /> },
		{
			href: "/devices/code",
			label: t("deck.rail.code"),
			icon: <TerminalIcon />,
		},
		{
			href: "/profile",
			label: t("deck.rail.you"),
			icon: <AccountCircleIcon />,
		},
	];
	const bottomNavigation = [
		{
			href: "/project",
			label: t("deck.bottom.project"),
			icon: <FolderIcon />,
		},
		{
			href: "/devices",
			label: t("deck.bottom.devices"),
			icon: <MemoryIcon />,
		},
		{
			href: "/profile",
			label: t("deck.bottom.profile"),
			icon: <AccountCircleIcon />,
		},
	];
	const workLinks: ContextLink[] = [
		{ href: "/project", labelKey: "deck.link.project" },
		{ href: "/devices/code", labelKey: "deck.link.code" },
		{ href: "/devices/docs", labelKey: "deck.link.learn" },
	];
	const contextLinks: ContextLink[] = pathname.startsWith("/profile")
		? PROFILE_TABS.map(deckLink)
		: pathname.startsWith("/devices")
			? deviceTabs(mode, isAdmin(session.data?.role)).map(deckLink)
			: workLinks;
	const contextTitle = pathname.startsWith("/profile")
		? t("deck.context.you")
		: pathname.startsWith("/devices")
			? t("deck.context.fleet")
			: t("deck.context.work");
	const activeContext = selectedHref(pathname, contextLinks);
	const admin = isAdmin(session.data?.role);
	const allNavLinks: ContextLink[] = [
		...workLinks,
		...deviceTabs(mode, admin).map(deckLink),
		...PROFILE_TABS.map(deckLink),
	];
	const seenHrefs = new Set<string>();
	const paletteNav = allNavLinks.filter((item) => {
		if (seenHrefs.has(item.href)) return false;
		seenHrefs.add(item.href);
		return true;
	});
	const actionsReady = Boolean(selectedBoardUuid && project);
	function arm(action: BoardAction) {
		if (!actionsReady) {
			return;
		}
		if (
			section === "/profile" ||
			(action === "save" && section !== "/project")
		) {
			navigate("/project");
		}
		requestAction(action);
		setPaletteOpen(false);
		setQuery("");
	}
	const boardActions = [
		{
			name: tAny("project.run"),
			hint: actionsReady
				? t("deck.secondary.project")
				: t("deck.command.disabled"),
			disabled: !actionsReady,
			run: () => arm("run"),
		},
		{
			name: tAny("flash.flash"),
			hint: actionsReady
				? t("deck.secondary.project")
				: t("deck.command.disabled"),
			disabled: !actionsReady,
			run: () => arm("flash"),
		},
		{
			name: tAny("verify.verify"),
			hint: actionsReady
				? t("deck.secondary.project")
				: t("deck.command.disabled"),
			disabled: !actionsReady,
			run: () => arm("verify"),
		},
		{
			name: tAny("project.saveToGithub"),
			hint: actionsReady
				? t("deck.secondary.project")
				: t("deck.command.disabled"),
			disabled: !actionsReady,
			run: () => arm("save"),
		},
		{
			name: tAny("credits.add"),
			hint: t("deck.secondary.profile"),
			disabled: false,
			run: () => navigate("/profile/credits"),
		},
	];
	const commands = [
		...rail.map((item) => ({
			name: item.label,
			hint: t("deck.command.navigate"),
			disabled: false,
			run: () => navigate(item.href),
		})),
		...paletteNav
			.filter((item) => !rail.some((railItem) => railItem.href === item.href))
			.map((item) => ({
				name: t(item.labelKey),
				hint: contextTitle,
				disabled: false,
				run: () => navigate(item.href),
			})),
		...boardActions,
		{
			name: t("deck.command.easy"),
			hint: t("deck.command.mode"),
			disabled: false,
			run: () => setMode("easy"),
		},
		{
			name: t("deck.command.expert"),
			hint: t("deck.command.mode"),
			disabled: false,
			run: () => setMode("expert"),
		},
		{
			name: t("deck.command.theme"),
			hint: t("deck.command.appearance"),
			disabled: false,
			run: toggleTheme,
		},
	];
	const normalizedQuery = query.trim().toLocaleLowerCase();
	const filteredCommands = commands.filter((command) =>
		`${command.name} ${command.hint}`
			.toLocaleLowerCase()
			.includes(normalizedQuery),
	);

	useEffect(() => {
		if (!pathname) return;
		setDrawerOpen(false);
		setPaletteOpen(false);
		setQuery("");
	}, [pathname]);

	useEffect(() => {
		if (paletteOpen) paletteInputRef.current?.focus();
	}, [paletteOpen]);

	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
				event.preventDefault();
				setPaletteOpen((open) => !open);
				return;
			}
			if (event.key === "Escape") {
				setPaletteOpen(false);
				setDrawerOpen(false);
				paletteTriggerRef.current?.focus();
				return;
			}
			if ((event.metaKey || event.ctrlKey) && event.key === "1") {
				event.preventDefault();
				setFocusRegion("primary");
				focusPane(primaryRef.current);
			}
			if ((event.metaKey || event.ctrlKey) && event.key === "2") {
				event.preventDefault();
				setFocusRegion("secondary");
				focusPane(secondaryRef.current);
			}
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, []);

	useEffect(() => {
		const onPointerMove = (event: PointerEvent) => {
			if (!dragRef.current) return;
			const next = Math.min(
				480,
				Math.max(
					64,
					dragRef.current.height + dragRef.current.y - event.clientY,
				),
			);
			setDockHeight(next);
		};
		const onPointerUp = () => {
			if (!dragRef.current) return;
			dragRef.current = null;
			window.localStorage.setItem(DOCK_STORAGE_KEY, String(dockHeight));
		};
		window.addEventListener("pointermove", onPointerMove);
		window.addEventListener("pointerup", onPointerUp);
		return () => {
			window.removeEventListener("pointermove", onPointerMove);
			window.removeEventListener("pointerup", onPointerUp);
		};
	}, [dockHeight]);

	useEffect(() => {
		if (mode === "easy" && dockTab === "problems") setDockTab("flash");
	}, [dockTab, mode, setDockTab]);

	useEffect(() => {
		if (!mobile || mobileDockInit.current) {
			return;
		}
		mobileDockInit.current = true;
		setDockOpen(false);
	}, [mobile, setDockOpen]);

	// biome-ignore lint/correctness/useExhaustiveDependencies: reset the highlighted command when the filter or dialog changes
	useEffect(() => {
		setActiveIndex(0);
	}, [query, paletteOpen]);

	function runCommand(
		command: { run: () => void; disabled?: boolean } | undefined,
	) {
		if (!command || command.disabled) return;
		command.run();
		setPaletteOpen(false);
		setQuery("");
	}

	function moveCommand(delta: number) {
		if (!filteredCommands.length) {
			return;
		}
		setActiveIndex((current) => {
			let next = current;
			for (let step = 0; step < filteredCommands.length; step += 1) {
				next =
					(next + delta + filteredCommands.length) % filteredCommands.length;
				if (!filteredCommands[next]?.disabled) {
					return next;
				}
			}
			return current;
		});
	}

	function trapPalette(event: React.KeyboardEvent<HTMLDivElement>) {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			moveCommand(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			moveCommand(-1);
			return;
		}
		if (event.key !== "Tab") {
			return;
		}
		const items = [
			...event.currentTarget.querySelectorAll<HTMLElement>(
				"button, input, a[href]",
			),
		].filter((item) => !item.hasAttribute("disabled"));
		const first = items[0];
		const last = items[items.length - 1];
		if (!first || !last) {
			return;
		}
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	function renderEntry(item: SidebarEntry) {
		const className = item.active ? "is-active" : undefined;
		if (item.href && !item.onSelect) {
			return (
				<a key={item.id} href={item.href} className={className}>
					{item.label}
				</a>
			);
		}
		return (
			<button
				key={item.id}
				type="button"
				className={className}
				onClick={() => {
					item.onSelect?.();
					setDrawerOpen(false);
				}}
			>
				{item.label}
			</button>
		);
	}

	function renderContext() {
		if (pathname.startsWith("/profile")) {
			return contextLinks.map((item) => (
				<a
					key={item.href}
					href={item.href}
					className={activeContext === item.href ? "is-active" : undefined}
					aria-current={activeContext === item.href ? "page" : undefined}
				>
					{t(item.labelKey)}
				</a>
			));
		}
		if (pathname.startsWith("/devices")) {
			return (
				<>
					{docsSidebar.length ? (
						<>
							<span className="b6-context-label">{t("deck.sidebar.toc")}</span>
							{docsSidebar.map((item) => renderEntry(item))}
						</>
					) : null}
					<span className="b6-context-label">{t("deck.sidebar.boards")}</span>
					{boards.length ? (
						boards.map((board) => (
							<button
								key={board.uuid}
								type="button"
								className={
									board.uuid === selectedBoardUuid ? "is-active" : undefined
								}
								onClick={() => {
									selectBoard(board.uuid);
									setDrawerOpen(false);
								}}
							>
								{publicBoardName(
									board,
									mode === "expert",
									t("deck.status.unnamed"),
								)}
							</button>
						))
					) : (
						<span className="b6-context-label">{t("deck.status.noBoard")}</span>
					)}
					<span className="b6-context-label">{t("deck.sidebar.pages")}</span>
					{contextLinks.map((item) => (
						<a
							key={item.href}
							href={item.href}
							className={
								activeContext === item.href ? "is-active is-child" : "is-child"
							}
							aria-current={activeContext === item.href ? "page" : undefined}
						>
							{t(item.labelKey)}
						</a>
					))}
				</>
			);
		}
		const repos = workSidebar.filter((item) => item.id.startsWith("repo:"));
		const files = workSidebar.filter((item) => item.id.startsWith("file:"));
		return (
			<>
				<span className="b6-context-label">{t("deck.sidebar.repos")}</span>
				{repos.length ? (
					repos.map((item) => renderEntry(item))
				) : (
					<span className="b6-context-label">
						{t("deck.sidebar.emptyWork")}
					</span>
				)}
				<span className="b6-context-label">{t("deck.sidebar.files")}</span>
				{files.map((item) =>
					item.href ? (
						<a key={item.id} href={item.href} className="is-child">
							{item.label}
						</a>
					) : (
						<span key={item.id} className="b6-context-label">
							{item.label}
						</span>
					),
				)}
				<a href="/devices/docs">{t("deck.link.learn")}</a>
			</>
		);
	}

	function renderLiveBoard() {
		const selected = boards.find((board) => board.uuid === selectedBoardUuid);
		if (!selected) {
			return <span>{t("deck.secondary.empty")}</span>;
		}
		const name = publicBoardName(
			selected,
			mode === "expert",
			t("deck.status.unnamed"),
		);
		return (
			<>
				<span
					className={`b6-live-status ${selected.online ? "is-online" : ""}`}
				>
					<i />
					{selected.online ? t("deck.status.online") : t("deck.status.offline")}
				</span>
				<strong>{name}</strong>
			</>
		);
	}

	function beginDockDrag(event: ReactPointerEvent<HTMLButtonElement>) {
		event.preventDefault();
		dragRef.current = { y: event.clientY, height: dockHeight };
	}

	function writeContextOpen(open: boolean) {
		setContextOpen(open);
		window.localStorage.setItem(CONTEXT_STORAGE_KEY, open ? "1" : "0");
	}

	return (
		<div className="b6-deck">
			<header className="b6-topbar">
				<IconButton
					className="b6-drawer-trigger"
					size="small"
					aria-label={t("deck.action.openNavigation")}
					onClick={() => setDrawerOpen(true)}
				>
					<MenuIcon />
				</IconButton>
				<a className="b6-brand" href="/project">
					<img src="/static/logo.png" alt="" width={24} height={24} />
					<span>{t("deck.brand")}</span>
				</a>
				<button
					ref={paletteTriggerRef}
					type="button"
					className="b6-palette-trigger"
					onClick={() => setPaletteOpen(true)}
				>
					<SearchIcon />
					<span>{t("deck.command.open")}</span>
					<kbd>{t("deck.command.shortcut")}</kbd>
				</button>
				<fieldset className="b6-mode-switch">
					<legend>{t("deck.mode.label")}</legend>
					<button
						type="button"
						className={mode === "easy" ? "is-active" : undefined}
						aria-pressed={mode === "easy"}
						onClick={() => setMode("easy")}
					>
						{t("deck.mode.easy")}
					</button>
					<button
						type="button"
						className={mode === "expert" ? "is-active" : undefined}
						aria-pressed={mode === "expert"}
						onClick={() => setMode("expert")}
					>
						{t("deck.mode.expert")}
					</button>
				</fieldset>
				<IconButton
					size="small"
					aria-label={isDark ? t("deck.theme.toLight") : t("deck.theme.toDark")}
					onClick={toggleTheme}
				>
					{isDark ? <LightModeIcon /> : <DarkModeIcon />}
				</IconButton>
			</header>

			<div className={`b6-body${contextOpen ? "" : " is-context-collapsed"}`}>
				<nav className="b6-rail" aria-label={t("deck.rail.label")}>
					{rail.map((item) => {
						const active =
							item.href === "/devices/code"
								? pathname.startsWith(item.href)
								: section === item.href &&
									!pathname.startsWith("/devices/code");
						return (
							<a
								key={item.href}
								href={item.href}
								className={active ? "is-active" : undefined}
								aria-current={active ? "page" : undefined}
							>
								{item.icon}
								<span>{item.label}</span>
							</a>
						);
					})}
					<button
						type="button"
						className="b6-rail-expand"
						aria-label={t("deck.action.expandContext")}
						onClick={() => writeContextOpen(true)}
					>
						<ChevronRightIcon />
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
				<aside className={`b6-context ${drawerOpen ? "is-open" : ""}`}>
					<div className="b6-context-heading">
						<div>
							<span>{t("deck.context.eyebrow")}</span>
							<strong>{contextTitle}</strong>
						</div>
						<div className="b6-context-heading-actions">
							<IconButton
								className="b6-context-collapse"
								size="small"
								aria-label={t("deck.action.collapseContext")}
								onClick={() => writeContextOpen(false)}
							>
								<ChevronLeftIcon />
							</IconButton>
							<IconButton
								className="b6-drawer-close"
								size="small"
								aria-label={t("deck.action.closeNavigation")}
								onClick={() => setDrawerOpen(false)}
							>
								<CloseIcon />
							</IconButton>
						</div>
					</div>
					<nav aria-label={t("deck.context.label")}>{renderContext()}</nav>
					<div className="b6-focus-hint">{t("deck.focus.contextHint")}</div>
				</aside>

				<div className="b6-workspace">
					<main className="b6-stage">
						<section
							ref={primaryRef}
							tabIndex={-1}
							aria-label={t("deck.focus.primary")}
							className={`b6-stage-primary ${focusRegion === "primary" ? "is-focused" : ""}`}
							onClick={() => setFocusRegion("primary")}
							onKeyDown={() => setFocusRegion("primary")}
						>
							<div
								className={`b6-stage-content${pathname.startsWith("/devices/code") ? " is-fill" : ""}`}
							>
								{children}
							</div>
						</section>
						<aside
							ref={secondaryRef}
							tabIndex={-1}
							aria-label={t("deck.focus.secondary")}
							className={`b6-stage-secondary ${focusRegion === "secondary" ? "is-focused" : ""}`}
							onClick={() => setFocusRegion("secondary")}
							onKeyDown={() => setFocusRegion("secondary")}
						>
							{renderLiveBoard()}
						</aside>
					</main>
					{section === "/profile" ? null : (
						<section
							className={`b6-dock ${dockOpen ? "" : "is-collapsed"}`}
							style={{ height: dockOpen ? dockHeight : 36 }}
							aria-label={t("deck.dock.label")}
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
								onPointerDown={beginDockDrag}
								onDoubleClick={() => {
									setDockHeight(DEFAULT_DOCK_HEIGHT);
									window.localStorage.setItem(
										DOCK_STORAGE_KEY,
										String(DEFAULT_DOCK_HEIGHT),
									);
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
											? DEFAULT_DOCK_HEIGHT
											: Math.min(480, Math.max(64, dockHeight + step));
									setDockHeight(next);
									window.localStorage.setItem(DOCK_STORAGE_KEY, String(next));
								}}
							/>
							<div className="b6-dock-tabs" role="tablist">
								{DOCK_TABS.filter(
									([tab]) => mode === "expert" || tab !== "problems",
								).map(([tab, Icon]) => (
									<button
										key={tab}
										type="button"
										role="tab"
										aria-selected={dockOpen && dockTab === tab}
										className={
											dockOpen && dockTab === tab ? "is-active" : undefined
										}
										onClick={() => {
											setDockTab(tab);
											setDockOpen(true);
										}}
									>
										<Icon />
										{t(`deck.dock.${tab}`)}
									</button>
								))}
								<label className="b6-dock-board">
									<select
										aria-label={t("deck.dock.connectBoard")}
										value={
											boards.some((board) => board.uuid === selectedBoardUuid)
												? selectedBoardUuid
												: ""
										}
										disabled={boards.length === 0}
										onChange={(event) => {
											selectBoard(event.target.value);
											setDockTab("console");
											setDockOpen(true);
										}}
									>
										{boards.some(
											(board) => board.uuid === selectedBoardUuid,
										) ? null : (
											<option value="">{t("deck.dock.connectBoard")}</option>
										)}
										{boards.map((board) => (
											<option key={board.uuid} value={board.uuid}>
												{publicBoardName(
													board,
													mode === "expert",
													t("deck.status.unnamed"),
												)}
											</option>
										))}
									</select>
								</label>
								<button type="button" onClick={() => setDockOpen(!dockOpen)}>
									{dockOpen ? t("deck.dock.collapse") : t("deck.dock.expand")}
								</button>
							</div>
							<div className="b6-dock-content" role="tabpanel">
								{dockOpen ? <DockBody /> : null}
							</div>
						</section>
					)}
				</div>
			</div>
			<footer className="b6-statusbar">
				<span>
					{selectedBoard
						? selectedBoard.online
							? t("deck.status.online")
							: t("deck.status.offline")
						: t("deck.status.ready")}
				</span>
				<span>
					{selectedBoard
						? publicBoardName(
								selectedBoard,
								mode === "expert",
								t("deck.status.unnamed"),
							)
						: t("deck.status.noBoard")}
				</span>
				<span>
					{consoleStatus === "live"
						? t("deck.status.consoleLive")
						: t("deck.status.consoleDown")}
				</span>
				<span className="b6-statusbar-shortcuts">
					{t("deck.status.shortcuts")}
				</span>
			</footer>

			{mobile ? (
				<Paper
					id={DASHBOARD_BOTTOM_NAV_ID}
					className="b6-bottom-nav"
					elevation={3}
					square
				>
					<BottomNavigation
						showLabels
						value={section}
						onChange={(_event, value) => navigate(String(value))}
					>
						{bottomNavigation.map((item) => (
							<BottomNavigationAction
								key={item.href}
								value={item.href}
								label={item.label}
								icon={item.icon}
							/>
						))}
					</BottomNavigation>
				</Paper>
			) : null}

			{paletteOpen ? (
				<div className="b6-palette-layer" role="presentation">
					<button
						type="button"
						className="b6-palette-scrim"
						aria-label={t("deck.command.close")}
						onClick={() => setPaletteOpen(false)}
					/>
					<div
						className="b6-palette"
						role="dialog"
						aria-modal="true"
						aria-label={t("deck.command.title")}
						onKeyDown={trapPalette}
					>
						<label className="b6-palette-search">
							<SearchIcon />
							<input
								ref={paletteInputRef}
								value={query}
								placeholder={t("deck.command.placeholder")}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={(event) => {
									if (event.key === "Enter") {
										event.preventDefault();
										runCommand(filteredCommands[activeIndex]);
									}
								}}
							/>
							<kbd>{t("deck.command.escape")}</kbd>
						</label>
						<div className="b6-command-list">
							{filteredCommands.length ? (
								filteredCommands.map((command, index) => (
									<button
										key={`${command.name}-${command.hint}`}
										type="button"
										disabled={command.disabled}
										className={index === activeIndex ? "is-active" : undefined}
										onClick={() => runCommand(command)}
										onMouseEnter={() => setActiveIndex(index)}
									>
										<span>{command.name}</span>
										<small>{command.hint}</small>
									</button>
								))
							) : (
								<div className="b6-command-empty">
									{t("deck.command.empty")}
								</div>
							)}
						</div>
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
				fullScreen={mobile}
				scroll="paper"
				sx={{ zIndex: 1400 }}
				slotProps={{ paper: { className: "max-w-xl w-full" } }}
			>
				<DialogTitle>{uiModal?.title ?? ""}</DialogTitle>
				<DialogContent>
					<p style={{ whiteSpace: "pre-wrap", margin: 0 }}>
						{uiModal?.body ?? ""}
					</p>
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
