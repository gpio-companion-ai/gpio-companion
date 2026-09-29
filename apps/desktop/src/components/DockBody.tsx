import { useEffect, useRef } from "react";
import type { ConsoleTunnelStatus } from "../hooks/useConsoleTunnel";
import { useDashboardMode } from "../hooks/useDashboardMode";
import { useT } from "../locale";
import FlashPanel from "./FlashPanel";
import FlashProxyButton from "./FlashProxyButton";
import GpioPanel from "./GpioPanel";
import VerifyPanel from "./VerifyPanel";

export type DesktopDockTab = "console" | "gpio" | "flash" | "problems";

export default function DockBody({
	tab,
	uuid,
	log,
	status,
	connected,
}: {
	tab: DesktopDockTab;
	uuid: string;
	log: string;
	status: ConsoleTunnelStatus;
	connected?: boolean;
}) {
	const t = useT();
	const { isEasy } = useDashboardMode();
	const logRef = useRef<HTMLPreElement>(null);

	useEffect(() => {
		const node = logRef.current;
		if (!node || log.length < 0) {
			return;
		}
		node.scrollTop = node.scrollHeight;
	}, [log]);

	if (!uuid) {
		return <span>{t("deck.dock.needBoard")}</span>;
	}
	if (tab === "gpio") {
		if (isEasy) {
			return <span>{t("deck.dock.gpioExpert")}</span>;
		}
		return <GpioPanel key={uuid} uuid={uuid} poll connected />;
	}
	if (tab === "flash") {
		return (
			<div className="b6-dock-stack">
				<FlashProxyButton uuid={uuid} connected={connected} />
				<FlashPanel uuid={uuid} />
			</div>
		);
	}
	if (tab === "problems") {
		return <VerifyPanel uuid={uuid} />;
	}
	return (
		<pre
			ref={logRef}
			className={log ? "b6-console-log" : "b6-console-log is-empty"}
			data-status={status}
		>
			{log || t("deck.dock.consoleEmpty")}
		</pre>
	);
}
