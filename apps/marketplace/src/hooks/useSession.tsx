import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useEffect,
	useState,
} from "react";
import { GET } from "../actions/api/session.ts";
import type { PublicSession } from "../lib/auth.ts";

type SessionValue = {
	session: PublicSession | null;
	ready: boolean;
	refresh: () => Promise<void>;
};

const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
	const [session, setSession] = useState<PublicSession | null>(null);
	const [ready, setReady] = useState(false);

	const refresh = useCallback(async () => {
		try {
			setSession(await GET());
		} catch {
			setSession(null);
		} finally {
			setReady(true);
		}
	}, []);

	useEffect(() => {
		void refresh();
	}, [refresh]);

	return (
		<SessionContext.Provider value={{ session, ready, refresh }}>
			{children}
		</SessionContext.Provider>
	);
}

export function useSession(): SessionValue {
	const value = useContext(SessionContext);
	if (!value) throw new Error("useSession must be used within SessionProvider");
	return value;
}
