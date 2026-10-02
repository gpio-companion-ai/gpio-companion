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
import { type BoardView, listDeviceStatus, savedBleId } from "../api";
import { QueryCache } from "../lib/query-cache";

export const CACHE_KEYS = {
	userBoards: "user-boards",
	githubApp: "github-app",
	projects: "projects-gpio",
	credits: "credits",
	creditsUsage: "credits-usage",
	notifications: "notifications",
	debugBoards: "debug-boards",
	adminDevices: "admin-devices",
	projectBundle: (owner: string, repo: string, ref?: string) =>
		ref
			? `project-bundle:${owner}/${repo}:${ref}`
			: `project-bundle:${owner}/${repo}`,
} as const;

export type UserBoards = {
	paired: boolean;
	devices: BoardView[];
};

type ApiCacheValue = {
	cache: QueryCache;
	version: number;
};

const ApiCacheCtx = createContext<ApiCacheValue | null>(null);

export function ApiCacheProvider({
	children,
	signedIn,
}: {
	children: ReactNode;
	signedIn: boolean;
}) {
	const cacheRef = useRef(new QueryCache());
	const cache = cacheRef.current;
	const [version, setVersion] = useState(0);

	useEffect(() => cache.subscribe(() => setVersion((n) => n + 1)), [cache]);

	useEffect(() => {
		if (!signedIn) {
			cache.clear();
			return;
		}
		void cache
			.get(CACHE_KEYS.userBoards, listDeviceStatus)
			.catch(() => undefined);
	}, [signedIn, cache]);

	const value = useMemo(() => ({ cache, version }), [cache, version]);
	return <ApiCacheCtx.Provider value={value}>{children}</ApiCacheCtx.Provider>;
}

export function useApiCache(): ApiCacheValue {
	const ctx = useContext(ApiCacheCtx);
	if (!ctx) {
		throw new Error("useApiCache requires ApiCacheProvider");
	}
	return ctx;
}

export function useCachedQuery<T>(key: string, fetcher: () => Promise<T>) {
	const { cache, version } = useApiCache();
	void version;
	const hit = cache.peek<T>(key);
	const [error, setError] = useState("");
	const [loading, setLoading] = useState(!hit.hit);

	useEffect(() => {
		let cancelled = false;
		if (hit.hit) {
			setLoading(false);
			return;
		}
		setLoading(true);
		void cache
			.get(key, fetcher)
			.then(() => {
				if (!cancelled) {
					setError("");
				}
			})
			.catch((caught) => {
				if (!cancelled) {
					setError(caught instanceof Error ? caught.message : "load failed");
				}
			})
			.finally(() => {
				if (!cancelled) {
					setLoading(false);
				}
			});
		return () => {
			cancelled = true;
		};
	}, [cache, fetcher, hit.hit, key]);

	const setData = useCallback(
		(value: T | ((prev: T | undefined) => T)) => {
			const prev = cache.peek<T>(key);
			const next =
				typeof value === "function"
					? (value as (prev: T | undefined) => T)(
							prev.hit ? prev.value : undefined,
						)
					: value;
			cache.set(key, next);
		},
		[cache, key],
	);

	const refetch = useCallback(
		(options?: { force?: boolean }) =>
			cache.get(key, fetcher, options?.force === true),
		[cache, fetcher, key],
	);

	return {
		data: hit.hit ? hit.value : undefined,
		error,
		loading: !hit.hit && loading,
		setData,
		refetch,
	};
}

export function useUserBoards() {
	const query = useCachedQuery(CACHE_KEYS.userBoards, listDeviceStatus);
	const boards = query.data?.devices ?? [];
	const devices = useMemo(() => boards.map((board) => board.device), [boards]);
	const { setData, refetch, error, loading } = query;

	const removeBoard = useCallback(
		(uuid: string) => {
			setData((current) => {
				const next = (current?.devices ?? []).filter(
					(item) => item.device.uuid !== uuid,
				);
				return { paired: next.length > 0, devices: next };
			});
		},
		[setData],
	);

	const patchLabel = useCallback(
		(uuid: string, label: string) => {
			setData((current) => {
				const next = (current?.devices ?? []).map((item) =>
					item.device.uuid === uuid
						? { ...item, device: { ...item.device, label } }
						: item,
				);
				return {
					paired: next.length > 0,
					devices: next,
				};
			});
		},
		[setData],
	);

	return {
		boards,
		devices,
		paired: boards.length > 0,
		error,
		loading,
		setData,
		refetch,
		removeBoard,
		patchLabel,
	};
}

export function useSavedBleId(uuid: string) {
	const { devices } = useUserBoards();
	return savedBleId(devices.find((device) => device.uuid === uuid));
}
