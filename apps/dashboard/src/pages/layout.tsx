import Box from "@shpaw415/mui-lite/Box";
import { isEmbedPath } from "gpio-companion";
import DeckShell from "../components/deck/DeckShell.tsx";
import { ActionErrorProvider } from "../hooks/useActionError.tsx";
import { usePathname } from "../hooks/usePathname.tsx";
import { WorkbenchProvider } from "../hooks/useWorkbench.tsx";

export default function Layout({ children }: { children: React.JSX.Element }) {
	const pathname = usePathname();
	const onEmbed = isEmbedPath(pathname);
	const simple = onEmbed || pathname === "/login" || pathname === "/callback";

	if (simple) {
		return (
			<ActionErrorProvider>
				<Box
					className={onEmbed ? undefined : "workbench-bg"}
					sx={{
						height: "100dvh",
						overflow: onEmbed ? "hidden" : "auto",
						bgcolor: "bg-main",
						display: "flex",
						flexDirection: "column",
						...(onEmbed
							? undefined
							: { alignItems: "center", justifyContent: "center", p: 2 }),
					}}
				>
					{children}
				</Box>
			</ActionErrorProvider>
		);
	}

	return (
		<ActionErrorProvider>
			<WorkbenchProvider>
				<DeckShell>{children}</DeckShell>
			</WorkbenchProvider>
		</ActionErrorProvider>
	);
}
