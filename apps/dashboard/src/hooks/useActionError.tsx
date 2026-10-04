import Snackbar from "@shpaw415/mui-lite/Snackbar";
import {
	createContext,
	type ReactNode,
	useCallback,
	useContext,
	useMemo,
	useState,
} from "react";
import {
	type ActionResult,
	runAction as runActionResult,
} from "../lib/action.ts";

type ActionErrorContextValue = {
	report: (error: string) => void;
	run: <T>(promise: Promise<ActionResult<T>>) => Promise<T | null>;
};

const ActionErrorContext = createContext<ActionErrorContextValue | null>(null);

export function ActionErrorProvider({ children }: { children: ReactNode }) {
	const [message, setMessage] = useState("");
	const [open, setOpen] = useState(false);

	const report = useCallback((error: string) => {
		setMessage(error);
		setOpen(true);
	}, []);

	const run = useCallback(
		<T,>(promise: Promise<ActionResult<T>>) => runActionResult(promise, report),
		[report],
	);

	const value = useMemo(() => ({ report, run }), [report, run]);

	return (
		<ActionErrorContext.Provider value={value}>
			{children}
			<Snackbar
				open={open}
				autoHideDuration={6000}
				onClose={() => setOpen(false)}
				message={message}
				position="top-center"
			/>
		</ActionErrorContext.Provider>
	);
}

export function useActionError(): ActionErrorContextValue {
	const ctx = useContext(ActionErrorContext);
	if (!ctx) {
		throw new Error("useActionError must be used within ActionErrorProvider");
	}
	return ctx;
}
