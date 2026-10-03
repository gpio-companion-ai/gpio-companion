import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import type { FitAddon } from "@xterm/addon-fit";
import type { Terminal } from "@xterm/xterm";
import { useEffect, useRef } from "react";
import { useT } from "../../hooks/useLocale.tsx";
import { useSshTunnel } from "../../hooks/useSshTunnel.ts";

export default function SshPanel({ uuid }: { uuid: string }) {
	const t = useT();
	const hostRef = useRef<HTMLDivElement | null>(null);
	const termRef = useRef<Terminal | null>(null);
	const fitRef = useRef<FitAddon | null>(null);
	const sendRef = useRef<(data: string) => void>(() => undefined);
	const resizeRef = useRef<(cols: number, rows: number) => void>(
		() => undefined,
	);
	const tunnel = useSshTunnel(uuid, (chunk) => termRef.current?.write(chunk));
	sendRef.current = tunnel.send;
	resizeRef.current = tunnel.resize;

	useEffect(() => {
		const node = hostRef.current;
		if (!node) {
			return;
		}
		let observer: ResizeObserver | null = null;
		let term: Terminal | null = null;
		let disposed = false;
		void (async () => {
			const [{ Terminal: XTerm }, { FitAddon: Fit }] = await Promise.all([
				import("@xterm/xterm"),
				import("@xterm/addon-fit"),
			]);
			if (disposed) {
				return;
			}
			const created = new XTerm({
				cursorBlink: true,
				fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
				fontSize: 12,
				scrollback: 2000,
				theme: {
					background: "rgba(0, 0, 0, 0)",
					foreground: "#d7dce3",
				},
			});
			const fit = new Fit();
			created.loadAddon(fit);
			created.open(node);
			fit.fit();
			created.onData((data) => sendRef.current(data));
			const ro = new ResizeObserver(() => {
				try {
					fit.fit();
					resizeRef.current(created.cols, created.rows);
				} catch {
					undefined;
				}
			});
			ro.observe(node);
			observer = ro;
			term = created;
			termRef.current = created;
			fitRef.current = fit;
		})();
		return () => {
			disposed = true;
			observer?.disconnect();
			term?.dispose();
			termRef.current = null;
			fitRef.current = null;
		};
	}, []);

	function handleConnect() {
		const term = termRef.current;
		const fit = fitRef.current;
		if (term && fit) {
			term.reset();
			try {
				fit.fit();
			} catch {
				undefined;
			}
			tunnel.resize(term.cols, term.rows);
		}
		tunnel.connect();
	}

	const busy = tunnel.status === "connecting" || tunnel.status === "auth";
	const live = tunnel.status === "live";

	return (
		<Stack spacing={1} className="b6-ssh">
			<Stack direction="row" spacing={1} className="flex-wrap items-center">
				<Button
					type="button"
					variant={live ? "outlined" : "contained"}
					color={live ? "error" : "primary"}
					disabled={busy}
					onClick={() => (live ? tunnel.disconnect() : handleConnect())}
				>
					{busy
						? t("deck.dock.sshConnecting")
						: live
							? t("deck.dock.sshDisconnect")
							: t("deck.dock.sshOpen")}
				</Button>
				<Typography variant="body2" color="secondary">
					{t("deck.dock.sshHint")}
				</Typography>
			</Stack>
			{tunnel.error ? (
				<Alert severity="error">
					{t("deck.dock.sshFailed", { message: tunnel.error })}
				</Alert>
			) : null}
			{tunnel.status === "closed" && !tunnel.error ? (
				<Typography variant="body2" color="secondary">
					{t("deck.dock.sshClosed")}
				</Typography>
			) : null}
			<div ref={hostRef} className="b6-ssh-term" />
		</Stack>
	);
}
