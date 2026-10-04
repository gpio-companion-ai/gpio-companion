import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useState,
} from "react";
import { storageGet, storageRemove, storageSet } from "./storage.ts";

const STORAGE_KEY = "gpio-companion-selected-board";
const LEGACY_STORAGE_KEY = "gpio-companion-t3-device";

type BoardSelectionValue = {
	uuid: string;
	setUuid: (uuid: string) => void;
	openCode: () => void;
	flashSketch: FlashSketchPreselect | null;
	setFlashSketch: (sketch: FlashSketchPreselect | null) => void;
};

export type FlashSketchPreselect = {
	dir: string;
	project: string;
	autoStart?: boolean;
};

const BoardSelectionCtx = createContext<BoardSelectionValue | null>(null);

export function BoardSelectionProvider({
	children,
	onOpenCode,
}: {
	children: ReactNode;
	onOpenCode?: () => void;
}) {
	const [uuid, setUuidState] = useState("");
	const [flashSketch, setFlashSketchState] =
		useState<FlashSketchPreselect | null>(null);

	useEffect(() => {
		void Promise.all([
			storageGet(STORAGE_KEY),
			storageGet(LEGACY_STORAGE_KEY),
		]).then(([stored, legacy]) => {
			const selected = stored?.trim() || legacy?.trim() || "";
			if (selected) setUuidState(selected);
		});
	}, []);

	const setUuid = useCallback((next: string) => {
		const trimmed = next.trim();
		setUuidState(trimmed);
		if (trimmed) {
			void storageSet(STORAGE_KEY, trimmed);
			void storageRemove(LEGACY_STORAGE_KEY);
		} else {
			void storageRemove(STORAGE_KEY);
		}
	}, []);

	const openCode = useCallback(() => {
		onOpenCode?.();
	}, [onOpenCode]);

	const setFlashSketch = useCallback((next: FlashSketchPreselect | null) => {
		setFlashSketchState(next);
	}, []);

	const value = useMemo(
		() => ({ uuid, setUuid, openCode, flashSketch, setFlashSketch }),
		[uuid, setUuid, openCode, flashSketch, setFlashSketch],
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
			flashSketch: null,
			setFlashSketch: () => undefined,
		};
	}
	return ctx;
}
