import Box from "@shpaw415/mui-lite/Box";
import CssBaseline from "@shpaw415/mui-lite/CssBaseline";
import { CircularProgress } from "@shpaw415/mui-lite/Progress";
import Stack from "@shpaw415/mui-lite/Stack";
import { useEffect, useState } from "react";
import {
	authLogout,
	authSession,
	authToken,
	onAuthRequired,
	type Session,
} from "./api";
import { useColorMode } from "./color-mode";
import DeckShell, { type DeckSection } from "./components/DeckShell";
import DevicesHub, { type DeviceTab } from "./components/DevicesHub";
import GithubAppCallbackBridge from "./components/GithubAppCallbackBridge";
import Login from "./components/Login";
import Profile from "./components/Profile";
import Project from "./components/Project";
import { ApiCacheProvider } from "./hooks/useApiCache";
import { BoardSelectionProvider } from "./hooks/useBoardSelection";

export default function App() {
	const { isDark, toggleMode } = useColorMode();
	const [ready, setReady] = useState(false);
	const [signedIn, setSignedIn] = useState(false);
	const [session, setSession] = useState<Session | null>(null);
	const [section, setSection] = useState<DeckSection>("project");
	const [deviceTab, setDeviceTab] = useState<DeviceTab>("overview");

	useEffect(() => {
		void authToken()
			.then((token) => setSignedIn(Boolean(token)))
			.finally(() => setReady(true));
		return onAuthRequired(() => setSignedIn(false));
	}, []);

	useEffect(() => {
		if (!signedIn) {
			setSession(null);
			return;
		}
		void authSession()
			.then(setSession)
			.catch(() => setSession(null));
	}, [signedIn]);

	if (!ready) {
		return (
			<Stack
				sx={{
					minHeight: "100dvh",
					alignItems: "center",
					justifyContent: "center",
				}}
			>
				<CircularProgress />
			</Stack>
		);
	}

	const admin = session?.role === "admin";

	return (
		<BoardSelectionProvider
			onOpenCode={() => {
				setSection("devices");
				setDeviceTab("code");
			}}
		>
			<ApiCacheProvider signedIn={signedIn}>
				{signedIn ? <GithubAppCallbackBridge /> : null}
				<CssBaseline />
				{signedIn ? (
					<DeckShell
						section={section}
						deviceTab={deviceTab}
						admin={Boolean(admin)}
						isDark={isDark}
						onNavigate={setSection}
						onDeviceTab={setDeviceTab}
						onToggleTheme={toggleMode}
					>
						{section === "project" ? (
							<Project onOpenProfile={() => setSection("profile")} />
						) : section === "profile" ? (
							<Profile
								session={session}
								onSignOut={() => {
									void authLogout().then(() => {
										setSignedIn(false);
										setSection("devices");
										setDeviceTab("overview");
									});
								}}
							/>
						) : (
							<DevicesHub
								tab={deviceTab}
								onTab={setDeviceTab}
								admin={Boolean(admin)}
								onOpenProject={() => setSection("project")}
							/>
						)}
					</DeckShell>
				) : (
					<Box
						className="workbench-bg"
						sx={{ height: "100%", overflow: "auto", p: 1.5 }}
					>
						<Login
							onSignedIn={() => {
								setSignedIn(true);
								setSection("devices");
							}}
						/>
					</Box>
				)}
			</ApiCacheProvider>
		</BoardSelectionProvider>
	);
}
