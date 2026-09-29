import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import type { ReactNode } from "react";
import { KeyboardProvider } from "react-native-keyboard-controller";
import { ApiCacheProvider } from "../src/lib/api-cache.tsx";
import { AuthProvider } from "../src/lib/auth.tsx";
import { BoardSelectionProvider } from "../src/lib/board-selection.tsx";
import { ColorModeProvider, useColorMode } from "../src/lib/color-mode.tsx";
import { DashboardModeProvider } from "../src/lib/dashboard-mode.tsx";
import { DeviceHubProvider, useDeviceHub } from "../src/lib/device-hub.tsx";
import { LocaleProvider, useT } from "../src/lib/locale.tsx";

function SignedInTree({ children }: { children: ReactNode }) {
	const { setTab } = useDeviceHub();
	return (
		<BoardSelectionProvider onOpenCode={() => setTab("code")}>
			<ApiCacheProvider>{children}</ApiCacheProvider>
		</BoardSelectionProvider>
	);
}

function RootStack() {
	const { isDark } = useColorMode();
	const t = useT();
	return (
		<>
			<StatusBar style={isDark ? "light" : "dark"} />
			<Stack screenOptions={{ headerShown: false }}>
				<Stack.Screen name="(tabs)" />
				<Stack.Screen
					name="auth/callback"
					options={{ headerShown: true, title: t("auth.signIn") }}
				/>
			</Stack>
		</>
	);
}

export default function Layout() {
	return (
		<KeyboardProvider statusBarTranslucent navigationBarTranslucent>
			<LocaleProvider>
				<ColorModeProvider>
					<DashboardModeProvider>
						<AuthProvider>
							<DeviceHubProvider>
								<SignedInTree>
									<RootStack />
								</SignedInTree>
							</DeviceHubProvider>
						</AuthProvider>
					</DashboardModeProvider>
				</ColorModeProvider>
			</LocaleProvider>
		</KeyboardProvider>
	);
}
