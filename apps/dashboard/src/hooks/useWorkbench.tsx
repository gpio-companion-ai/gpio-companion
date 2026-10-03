import { GET as getDevice } from "@api/device";
import type { CircuitVerifyItem, GpioTarget } from "gpio-companion";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { unwrapAction } from "../lib/action.ts";
import { deviceDisplayName } from "../lib/pairing-store.ts";
import { useAuthSession } from "./useAuth.ts";

export type FleetBoard = {
	uuid: string;
	label: string;
	model: string;
	online: boolean;
};

export type SidebarEntry = {
	id: string;
	label: string;
	hint?: string;
	active?: boolean;
	href?: string;
	onSelect?: () => void;
};

export type ConsoleLinkStatus = "idle" | "connecting" | "live" | "reconnecting";
export type BoardAction = "run" | "flash" | "verify" | "save";
export type DockTab =
	| "console"
	| "gpio"
	| "flash"
	| "problems"
	| "actions"
	| "ssh";
export type FlashSketchPreselect = { dir: string; project: string };

type WorkbenchValue = {
	boards: FleetBoard[];
	refreshBoards: () => void;
	setBoardPresence: (uuid: string, online: boolean) => void;
	project: string;
	setProject: (name: string) => void;
	flashSketch: FlashSketchPreselect | null;
	setFlashSketch: (sketch: FlashSketchPreselect | null) => void;
	consoleStatus: ConsoleLinkStatus;
	setConsoleStatus: (status: ConsoleLinkStatus) => void;
	pendingAction: BoardAction | null;
	requestAction: (action: BoardAction) => void;
	clearPending: () => void;
	dockOpen: boolean;
	setDockOpen: (open: boolean) => void;
	dockTab: DockTab;
	setDockTab: (tab: DockTab) => void;
	workSidebar: SidebarEntry[];
	setWorkSidebar: (items: SidebarEntry[]) => void;
	docsSidebar: SidebarEntry[];
	setDocsSidebar: (items: SidebarEntry[]) => void;
	livePins: Record<number, 0 | 1>;
	arduinoLivePins: Record<number, 0 | 1>;
	setLivePins: (pins: Record<number, 0 | 1>, target?: GpioTarget) => void;
	verifyResults: CircuitVerifyItem[];
	setVerifyResults: (results: CircuitVerifyItem[]) => void;
};

const EMPTY_BOARDS: FleetBoard[] = [];
const EMPTY_SIDEBAR: SidebarEntry[] = [];

const fallback: WorkbenchValue = {
	boards: EMPTY_BOARDS,
	refreshBoards: () => undefined,
	setBoardPresence: () => undefined,
	project: "",
	setProject: () => undefined,
	flashSketch: null,
	setFlashSketch: () => undefined,
	consoleStatus: "idle",
	setConsoleStatus: () => undefined,
	pendingAction: null,
	requestAction: () => undefined,
	clearPending: () => undefined,
	dockOpen: true,
	setDockOpen: () => undefined,
	dockTab: "console",
	setDockTab: () => undefined,
	workSidebar: EMPTY_SIDEBAR,
	setWorkSidebar: () => undefined,
	docsSidebar: EMPTY_SIDEBAR,
	setDocsSidebar: () => undefined,
	livePins: {},
	arduinoLivePins: {},
	setLivePins: () => undefined,
	verifyResults: [],
	setVerifyResults: () => undefined,
};

const WorkbenchCtx = createContext<WorkbenchValue | null>(null);

function modelOf(status: Record<string, unknown> | null): string {
	const model = status?.model;
	const hardware = status?.hardware;
	if (typeof model === "string" && model.trim()) {
		return model.trim();
	}
	if (typeof hardware === "string" && hardware.trim()) {
		return hardware.trim();
	}
	return "";
}

function tabFor(action: BoardAction): DockTab {
	if (action === "flash") {
		return "flash";
	}
	if (action === "verify") {
		return "problems";
	}
	return "console";
}

export function WorkbenchProvider({ children }: { children: ReactNode }) {
	const session = useAuthSession();
	const [boards, setBoards] = useState<FleetBoard[]>(EMPTY_BOARDS);
	const [project, setProjectState] = useState("");
	const [flashSketch, setFlashSketch] = useState<FlashSketchPreselect | null>(
		null,
	);
	const [consoleStatus, setConsoleStatus] = useState<ConsoleLinkStatus>("idle");
	const [pendingAction, setPendingAction] = useState<BoardAction | null>(null);
	const [dockOpen, setDockOpen] = useState(true);
	const [dockTab, setDockTab] = useState<DockTab>("console");
	const [workSidebar, setWorkSidebar] = useState<SidebarEntry[]>(EMPTY_SIDEBAR);
	const [docsSidebar, setDocsSidebar] = useState<SidebarEntry[]>(EMPTY_SIDEBAR);
	const [livePins, setHeaderPins] = useState<Record<number, 0 | 1>>({});
	const [arduinoLivePins, setArduinoPins] = useState<Record<number, 0 | 1>>({});
	const [verifyResults, setVerifyResults] = useState<CircuitVerifyItem[]>([]);
	const loadId = useRef(0);
	const setBoardPresence = useCallback((uuid: string, online: boolean) => {
		setBoards((items) =>
			items.map((board) =>
				board.uuid === uuid ? { ...board, online } : board,
			),
		);
	}, []);

	const refreshBoards = useCallback(() => {
		const userId = session.data?.id;
		const requestId = loadId.current + 1;
		loadId.current = requestId;
		if (!userId) {
			setBoards(EMPTY_BOARDS);
			return;
		}
		void getDevice()
			.then((result) => unwrapAction(result))
			.then((result) => {
				if (loadId.current !== requestId || !result.paired) {
					if (loadId.current === requestId) {
						setBoards(EMPTY_BOARDS);
					}
					return;
				}
				setBoards(
					result.devices.map((item) => ({
						uuid: item.device.uuid,
						label: deviceDisplayName(item.device),
						model: modelOf(item.status),
						online: Boolean(item.status),
					})),
				);
			})
			.catch(() => {
				if (loadId.current === requestId) {
					setBoards(EMPTY_BOARDS);
				}
			});
	}, [session.data?.id]);

	useEffect(() => {
		refreshBoards();
	}, [refreshBoards]);

	const setProject = useCallback((name: string) => {
		setProjectState(name);
	}, []);

	const updateFlashSketch = useCallback(
		(sketch: FlashSketchPreselect | null) => {
			setFlashSketch(sketch);
		},
		[],
	);

	const clearPending = useCallback(() => {
		setPendingAction(null);
	}, []);

	const requestAction = useCallback((action: BoardAction) => {
		setPendingAction(action);
		setDockOpen(true);
		setDockTab(tabFor(action));
	}, []);

	const setLivePins = useCallback(
		(pins: Record<number, 0 | 1>, target?: GpioTarget) => {
			if (target === "arduino-proxy") {
				setArduinoPins(pins);
				return;
			}
			setHeaderPins(pins);
		},
		[],
	);

	const value = useMemo<WorkbenchValue>(
		() => ({
			boards,
			refreshBoards,
			setBoardPresence,
			project,
			setProject,
			flashSketch,
			setFlashSketch: updateFlashSketch,
			consoleStatus,
			setConsoleStatus,
			pendingAction,
			requestAction,
			clearPending,
			dockOpen,
			setDockOpen,
			dockTab,
			setDockTab,
			workSidebar,
			setWorkSidebar,
			docsSidebar,
			setDocsSidebar,
			livePins,
			arduinoLivePins,
			setLivePins,
			verifyResults,
			setVerifyResults,
		}),
		[
			boards,
			refreshBoards,
			setBoardPresence,
			project,
			setProject,
			flashSketch,
			updateFlashSketch,
			consoleStatus,
			pendingAction,
			requestAction,
			clearPending,
			dockOpen,
			dockTab,
			workSidebar,
			docsSidebar,
			livePins,
			arduinoLivePins,
			setLivePins,
			verifyResults,
		],
	);

	return (
		<WorkbenchCtx.Provider value={value}>{children}</WorkbenchCtx.Provider>
	);
}

export function useWorkbench(): WorkbenchValue {
	return useContext(WorkbenchCtx) ?? fallback;
}

export function useArmedAction(
	action: BoardAction,
	enabled: boolean,
	run: () => void,
) {
	const { pendingAction, clearPending } = useWorkbench();
	const runRef = useRef(run);
	runRef.current = run;

	useEffect(() => {
		if (pendingAction !== action || !enabled) {
			return;
		}
		clearPending();
		runRef.current();
	}, [action, clearPending, enabled, pendingAction]);
}
