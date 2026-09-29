import CloseIcon from "@material-design-icons/svg/filled/close.svg";
import FitScreenIcon from "@material-design-icons/svg/filled/fit_screen.svg";
import FullscreenIcon from "@material-design-icons/svg/filled/fullscreen.svg";
import ZoomInIcon from "@material-design-icons/svg/filled/zoom_in.svg";
import ZoomOutIcon from "@material-design-icons/svg/filled/zoom_out.svg";
import IconButton from "@shpaw415/mui-lite/IconButton";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { decodeModelBase64, type ModelPart } from "gpio-companion";
import { useEffect, useRef, useState } from "react";
import { useT } from "../hooks/useLocale.tsx";
import { type ModelScene, mountModelScene } from "../lib/model-scene.ts";

type Props = {
	glbBase64?: string | null;
	parts?: ModelPart[];
	activeName?: string | null;
	onSelect?: (name: string) => void;
	fill?: boolean;
};

export default function ModelViewer({
	glbBase64,
	parts = [],
	activeName,
	onSelect,
	fill = false,
}: Props) {
	const t = useT();
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const sceneRef = useRef<ModelScene | null>(null);
	const [expanded, setExpanded] = useState(false);
	const [failed, setFailed] = useState(false);

	useEffect(() => {
		const canvas = canvasRef.current;
		if (!glbBase64 || !canvas) {
			setFailed(false);
			return;
		}
		let bytes: Uint8Array;
		try {
			bytes = decodeModelBase64(glbBase64);
		} catch {
			setFailed(true);
			return;
		}
		let cancelled = false;
		setFailed(false);
		void mountModelScene(canvas, bytes)
			.then((scene) => {
				if (cancelled) {
					scene.dispose();
					return;
				}
				sceneRef.current = scene;
			})
			.catch(() => {
				if (!cancelled) {
					setFailed(true);
				}
			});
		return () => {
			cancelled = true;
			sceneRef.current?.dispose();
			sceneRef.current = null;
		};
	}, [glbBase64]);

	if (parts.length === 0 && (!glbBase64 || failed)) {
		return (
			<Paper className="workbench-empty project-preview-empty" elevation={0}>
				<Typography color="secondary">{t("project.noModel")}</Typography>
			</Paper>
		);
	}

	const overlay = expanded && !fill;
	return (
		<Paper
			className={
				overlay
					? "fixed inset-0 z-[1300] flex h-full flex-col overflow-hidden rounded-none p-4"
					: fill
						? "flex h-full min-h-0 flex-col overflow-hidden rounded-none p-3"
						: "workbench-panel overflow-hidden p-4"
			}
			elevation={overlay ? 8 : fill ? 0 : 1}
			sx={
				overlay
					? {
							paddingTop: "max(1rem, env(safe-area-inset-top))",
							paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
						}
					: fill
						? { height: "100%", minHeight: 0 }
						: undefined
			}
		>
			<Stack direction="row" spacing={0.5} className="mb-2 items-center">
				<Typography variant="subtitle1" className="min-w-0 flex-1">
					{t("project.model")}
				</Typography>
				<IconButton
					aria-label={t("board.zoomOut")}
					color="secondary"
					onClick={() => sceneRef.current?.zoomBy(1.25)}
					size="small"
				>
					<ZoomOutIcon fill="currentColor" />
				</IconButton>
				<IconButton
					aria-label={t("board.zoomIn")}
					color="secondary"
					onClick={() => sceneRef.current?.zoomBy(1 / 1.25)}
					size="small"
				>
					<ZoomInIcon fill="currentColor" />
				</IconButton>
				<IconButton
					aria-label={t("board.fit")}
					color="secondary"
					onClick={() => sceneRef.current?.fit()}
					size="small"
				>
					<FitScreenIcon fill="currentColor" />
				</IconButton>
				{fill ? null : (
					<IconButton
						aria-label={
							expanded ? t("board.exitFullScreen") : t("board.fullScreen")
						}
						color={expanded ? "error" : "secondary"}
						onClick={() => setExpanded((value) => !value)}
						size="small"
						sx={
							expanded
								? {
										backgroundColor: "rgba(var(--bg-error), 0.18)",
										"&:hover": {
											backgroundColor: "rgba(var(--bg-error), 0.3) !important",
										},
									}
								: undefined
						}
					>
						{expanded ? (
							<CloseIcon fill="currentColor" />
						) : (
							<FullscreenIcon fill="currentColor" />
						)}
					</IconButton>
				)}
			</Stack>
			{parts.length > 0 ? (
				<Stack
					direction="row"
					spacing={1}
					className="mb-2"
					sx={{ flexWrap: "wrap" }}
				>
					{parts.map((part) => (
						<button
							key={part.name}
							type="button"
							aria-pressed={part.name === activeName}
							className={`rounded px-3 py-1 text-left text-sm model-part ${
								part.name === activeName ? "is-active" : ""
							}`}
							onClick={() => onSelect?.(part.name)}
						>
							{part.name}
							<span className="ml-2 text-xs opacity-80">
								{part.fits.map((fit) => fitLabel(t, fit)).join(", ")}
							</span>
						</button>
					))}
				</Stack>
			) : null}
			{!glbBase64 || failed ? (
				<Typography color="secondary">
					{failed ? t("project.noModel") : t("project.modelLoading")}
				</Typography>
			) : (
				<div
					aria-label={t("project.modelCanvas")}
					className={`model-canvas relative min-h-0 overflow-hidden ${
						expanded || fill ? "flex-1" : "h-[320px] min-[900px]:h-[420px]"
					}`}
					role="application"
				>
					<canvas ref={canvasRef} className="block h-full w-full touch-none" />
				</div>
			)}
		</Paper>
	);
}

function fitLabel(t: ReturnType<typeof useT>, fit: string): string {
	if (fit === "companion-header") {
		return t("project.fitsCompanion");
	}
	if (fit === "arduino-uno") {
		return t("project.fitsUno");
	}
	if (fit === "arduino-nano") {
		return t("project.fitsNano");
	}
	if (fit === "arduino-mega") {
		return t("project.fitsMega");
	}
	return fit;
}
