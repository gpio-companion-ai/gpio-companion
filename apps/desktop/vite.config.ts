import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const host = process.env.TAURI_DEV_HOST;
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");

export default defineConfig({
	plugins: [react()],
	resolve: {
		alias: {
			"gpio-companion": path.resolve(
				repoRoot,
				"packages/core/src/breadboard-view.ts",
			),
			"gpio-companion-i18n": path.resolve(
				repoRoot,
				"packages/core/src/i18n/index.ts",
			),
			"gpio-companion-wifi": path.resolve(
				repoRoot,
				"packages/core/src/wifi.ts",
			),
			"gpio-companion-pairing": path.resolve(
				repoRoot,
				"packages/core/src/pairing.ts",
			),
		},
	},
	clearScreen: false,
	server: {
		port: 1420,
		strictPort: true,
		host: host || false,
		hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
		watch: { ignored: ["**/src-tauri/**"] },
		fs: { allow: [here, repoRoot] },
	},
});
