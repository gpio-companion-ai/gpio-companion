import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useRef,
	useState,
} from "react";

export type SidebarEntry = {
	id: string;
	label: string;
	active?: boolean;
	onSelect?: () => void;
};

export type ProfileSection = "account" | "github" | "credits" | "address";

type DeckNavValue = {
	workItems: SidebarEntry[];
	setWorkItems: (items: SidebarEntry[]) => void;
	docsItems: SidebarEntry[];
	setDocsItems: (items: SidebarEntry[]) => void;
	profileSection: ProfileSection;
	setProfileSection: (section: ProfileSection) => void;
	jumpProfile: (section: ProfileSection) => void;
	consumeProfileJump: () => ProfileSection | null;
	registerProfileJump: (
		jump: ((section: ProfileSection) => void) | null,
	) => void;
};

const EMPTY: SidebarEntry[] = [];

const DeckNavCtx = createContext<DeckNavValue | null>(null);

export function DeckNavProvider({ children }: { children: ReactNode }) {
	const [workItems, setWorkItemsState] = useState<SidebarEntry[]>(EMPTY);
	const [docsItems, setDocsItemsState] = useState<SidebarEntry[]>(EMPTY);
	const [profileSection, setProfileSection] =
		useState<ProfileSection>("account");
	const jumpRef = useRef<((section: ProfileSection) => void) | null>(null);
	const pendingProfile = useRef<ProfileSection | null>(null);

	const setWorkItems = useCallback((items: SidebarEntry[]) => {
		setWorkItemsState(items.length ? items : EMPTY);
	}, []);
	const setDocsItems = useCallback((items: SidebarEntry[]) => {
		setDocsItemsState(items.length ? items : EMPTY);
	}, []);
	const registerProfileJump = useCallback(
		(jump: ((section: ProfileSection) => void) | null) => {
			jumpRef.current = jump;
			if (!jump || !pendingProfile.current) {
				return;
			}
			const section = pendingProfile.current;
			pendingProfile.current = null;
			jump(section);
		},
		[],
	);
	const jumpProfile = useCallback((section: ProfileSection) => {
		setProfileSection(section);
		pendingProfile.current = section;
		jumpRef.current?.(section);
	}, []);
	const consumeProfileJump = useCallback(() => {
		const section = pendingProfile.current;
		pendingProfile.current = null;
		return section;
	}, []);

	const value = useMemo(
		() => ({
			workItems,
			setWorkItems,
			docsItems,
			setDocsItems,
			profileSection,
			setProfileSection,
			jumpProfile,
			consumeProfileJump,
			registerProfileJump,
		}),
		[
			docsItems,
			consumeProfileJump,
			jumpProfile,
			profileSection,
			registerProfileJump,
			setDocsItems,
			setWorkItems,
			workItems,
		],
	);

	return <DeckNavCtx.Provider value={value}>{children}</DeckNavCtx.Provider>;
}

export function useDeckNav(): DeckNavValue {
	const ctx = useContext(DeckNavCtx);
	if (!ctx) {
		throw new Error("useDeckNav requires DeckNavProvider");
	}
	return ctx;
}
