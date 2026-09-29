import IconButton from "@shpaw415/mui-lite/IconButton";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import { decodeModelBase64, type ModelPart } from "gpio-companion";
import { useEffect, useRef, useState } from "react";
import { type ModelScene, mountModelScene } from "../lib/model-scene";
import { useT } from "../locale";

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
			<Paper className="workbench-empty" sx={{ p: 4 }} elevation={0}>
				<Typography color="secondary" align="center">
					{t("project.noModel")}
				</Typography>
			</Paper>
		);
	}

	const overlay = expanded && !fill;
	return (
		<Paper
			elevation={overlay ? 8 : 1}
			sx={
				overlay
					? {
							position: "fixed",
							inset: 0,
							zIndex: 1300,
							display: "flex",
							flexDirection: "column",
							height: "100%",
							borderRadius: 0,
							p: 2,
							paddingTop: "max(1rem, env(safe-area-inset-top))",
							paddingBottom: "max(1rem, env(safe-area-inset-bottom))",
						}
					: fill
						? {
								p: 1,
								overflow: "hidden",
								display: "flex",
								flexDirection: "column",
								height: "100%",
								minHeight: 0,
								borderRadius: 0,
							}
						: { p: 2, overflow: "hidden" }
			}
		>
			<Stack direction="row" spacing={0.5} sx={{ alignItems: "center", mb: 1 }}>
				<Typography variant="subtitle1" sx={{ flex: 1, minWidth: 0 }}>
					{t("project.model")}
				</Typography>
				<IconButton
					aria-label={t("board.zoomOut")}
					color="secondary"
					onClick={() => sceneRef.current?.zoomBy(1.25)}
					size="small"
				>
					<ZoomOutIcon />
				</IconButton>
				<IconButton
					aria-label={t("board.zoomIn")}
					color="secondary"
					onClick={() => sceneRef.current?.zoomBy(1 / 1.25)}
					size="small"
				>
					<ZoomInIcon />
				</IconButton>
				<IconButton
					aria-label={t("board.fit")}
					color="secondary"
					onClick={() => sceneRef.current?.fit()}
					size="small"
				>
					<FitScreenIcon />
				</IconButton>
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
					{expanded ? <CloseIcon /> : <FullscreenIcon />}
				</IconButton>
			</Stack>
			{parts.length > 0 ? (
				<Stack
					direction="row"
					spacing={1}
					sx={{ flexWrap: "wrap", mb: 1, gap: 1 }}
				>
					{parts.map((part) => {
						const active = part.name === activeName;
						return (
							<button
								key={part.name}
								type="button"
								aria-pressed={active}
								onClick={() => onSelect?.(part.name)}
								style={{
									border: "1px solid rgba(var(--text-main), 0.16)",
									borderRadius: 8,
									padding: "4px 12px",
									textAlign: "left",
									fontSize: 14,
									color: active
										? "rgb(var(--text-primary))"
										: "rgb(var(--text-secondary))",
									background: active
										? "rgba(var(--text-primary), 0.16)"
										: "transparent",
								}}
							>
								{part.name}
								<span style={{ marginLeft: 8, fontSize: 12, opacity: 0.8 }}>
									{part.fits.map((fit) => fitLabel(t, fit)).join(", ")}
								</span>
							</button>
						);
					})}
				</Stack>
			) : null}
			{!glbBase64 || failed ? (
				<Typography color="secondary">
					{failed ? t("project.noModel") : t("project.modelLoading")}
				</Typography>
			) : (
				<div
					aria-label={t("project.modelCanvas")}
					role="application"
					style={{
						position: "relative",
						minHeight: 0,
						overflow: "hidden",
						height: overlay || fill ? undefined : 420,
						flex: overlay || fill ? 1 : undefined,
						background: "rgb(var(--bg-main))",
					}}
				>
					<canvas
						ref={canvasRef}
						style={{
							display: "block",
							width: "100%",
							height: "100%",
							touchAction: "none",
						}}
					/>
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

function ZoomOutIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79L20 21.5 21.5 20zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14M7 9h5v1H7z"
				fill="currentColor"
			/>
		</svg>
	);
}

function ZoomInIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M15.5 14h-.79l-.28-.27A6.5 6.5 0 1 0 14 15.5l.27.28v.79L20 21.5 21.5 20zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14M10 7v2H8v1h2v2h1V10h2V9h-2V7z"
				fill="currentColor"
			/>
		</svg>
	);
}

function FitScreenIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M6 16h2v2H6zm0-4h2v2H6zm0-4h2v2H6zm4 8h8v2h-8zm0-8h8v2h-8zm0 4h8v2h-8zM4 4h16v16H4z"
				fill="currentColor"
			/>
		</svg>
	);
}

function FullscreenIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M7 14H5v5h5v-2H7zm12-9h-5v2h3v3h2zM7 7h3V5H5v5h2zm12 12h-5v-2h3v-3h2z"
				fill="currentColor"
			/>
		</svg>
	);
}

function CloseIcon() {
	return (
		<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden>
			<path
				d="M19 6.41 17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"
				fill="currentColor"
			/>
		</svg>
	);
}
