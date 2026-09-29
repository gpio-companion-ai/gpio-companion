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

type BoardSelectionValue = {
	uuid: string;
	setUuid: (uuid: string) => void;
	openCode: () => void;
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

	const setUuid = useCallback((next: string) => {
		const trimmed = next.trim();
		setUuidState(trimmed);
		writeStoredUuid(trimmed);
	}, []);

	const openCode = useCallback(() => {
		onOpenCode?.();
	}, [onOpenCode]);

	const value = useMemo(
		() => ({ uuid, setUuid, openCode }),
		[uuid, setUuid, openCode],
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
		return {
			uuid: "",
			setUuid: () => undefined,
			openCode: () => undefined,
		};
	}
	return ctx;
}
