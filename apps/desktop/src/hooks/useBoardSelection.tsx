import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";

const STORAGE_KEY = "gpio-companion-selected-board";
const LEGACY_STORAGE_KEY = "gpio-companion-t3-device";

export type FlashSketchPreselect = { dir: string; project: string };

export type DockTab = "console" | "gpio" | "flash" | "problems" | "actions";

type BoardSelectionValue = {
	uuid: string;
	setUuid: (uuid: string) => void;
	openCode: () => void;
	flashSketch: FlashSketchPreselect | null;
	setFlashSketch: (sketch: FlashSketchPreselect | null) => void;
	dockTab: DockTab;
	setDockTab: (tab: DockTab) => void;
	dockOpen: boolean;
	setDockOpen: (open: boolean) => void;
};

const fallbackValue: BoardSelectionValue = {
	uuid: "",
	setUuid: () => undefined,
	openCode: () => undefined,
	flashSketch: null,
	setFlashSketch: () => undefined,
	dockTab: "console",
	setDockTab: () => undefined,
	dockOpen: true,
	setDockOpen: () => undefined,
};

const BoardSelectionCtx = createContext<BoardSelectionValue | null>(null);

function readStoredUuid(): string {
	try {
		return (
			window.localStorage.getItem(STORAGE_KEY)?.trim() ||
			window.localStorage.getItem(LEGACY_STORAGE_KEY)?.trim() ||
			""
		);
	} catch {
		return "";
	}
}

function writeStoredUuid(uuid: string) {
	try {
		if (uuid) {
			window.localStorage.setItem(STORAGE_KEY, uuid);
			window.localStorage.removeItem(LEGACY_STORAGE_KEY);
		} else {
			window.localStorage.removeItem(STORAGE_KEY);
		}
	} catch {
		return;
	}
}

export function BoardSelectionProvider({
	children,
	onOpenCode,
}: {
	children: ReactNode;
	onOpenCode?: () => void;
}) {
	const [uuid, setUuidState] = useState(readStoredUuid);
	const [flashSketch, setFlashSketchState] =
		useState<FlashSketchPreselect | null>(null);
	const [dockTab, setDockTab] = useState<DockTab>("console");
	const [dockOpen, setDockOpen] = useState(true);

	const setUuid = useCallback((next: string) => {
		const trimmed = next.trim();
		setUuidState(trimmed);
		writeStoredUuid(trimmed);
	}, []);

	const setFlashSketch = useCallback((next: FlashSketchPreselect | null) => {
		setFlashSketchState(next);
	}, []);

	const openCode = useCallback(() => {
		onOpenCode?.();
	}, [onOpenCode]);

	const value = useMemo(
		() => ({
			uuid,
			setUuid,
			openCode,
			flashSketch,
			setFlashSketch,
			dockTab,
			setDockTab,
			dockOpen,
			setDockOpen,
		}),
		[
			uuid,
			setUuid,
			openCode,
			flashSketch,
			setFlashSketch,
			dockTab,
			dockOpen,
		],
	);
	return (
		<BoardSelectionCtx.Provider value={value}>
			{children}
		</BoardSelectionCtx.Provider>
	);
}

export function useBoardSelection(): BoardSelectionValue {
	const ctx = useContext(BoardSelectionCtx);
	if (!ctx) {
		return fallbackValue;
	}
	return ctx;
}
