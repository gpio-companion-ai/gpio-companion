import CloseIcon from "@material-design-icons/svg/filled/close.svg";
import FitScreenIcon from "@material-design-icons/svg/filled/fit_screen.svg";
import FullscreenIcon from "@material-design-icons/svg/filled/fullscreen.svg";
import ZoomInIcon from "@material-design-icons/svg/filled/zoom_in.svg";
import ZoomOutIcon from "@material-design-icons/svg/filled/zoom_out.svg";
import IconButton from "@shpaw415/mui-lite/IconButton";
import Paper from "@shpaw415/mui-lite/Paper";
import Stack from "@shpaw415/mui-lite/Stack";
import Typography from "@shpaw415/mui-lite/Typography";
import {
	arduinoProxyBoardLayout,
	arduinoProxyBoardSize,
	arduinoProxyBoardTitle,
	arduinoProxyPadOffset,
	BREADBOARD_LEFT_COLS,
	BREADBOARD_PITCH,
	BREADBOARD_RAILS,
	BREADBOARD_RIGHT_COLS,
	breadboardEndpointLabel,
	breadboardHasRails,
	breadboardPinNames,
	breadboardPinOffset,
	breadboardRows,
	breadboardSize,
	type CircuitVerifyOverlay,
	type CircuitVerifyStatus,
	circuitVerifyColor,
	GPIO_COMPANION_HEADER_TYPE,
	type HeaderPinDef,
	headerPinOffset,
	headerPinsForBoard,
	headerSize,
	isArduinoProxyPartType,
	isBreadboardType,
	isHardwareId,
	type PartPinInfo,
	type Point,
	parseWokwiDiagram,
	partPinsFor,
	resolveBreadboardEndpoint,
	rotatePoint,
	snapPartPlacement,
	splitEndpoint,
	type WokwiDiagram,
	type WokwiPart,
	wirePath,
} from "gpio-companion";
import {
	type CSSProperties,
	createElement,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useT } from "../hooks/useLocale.tsx";
import {
	fitContain,
	fitRect,
	panBy,
	type Viewport,
	zoomAt,
} from "../lib/viewport-zoom.ts";

type Props = {
	diagramText?: string | null;
	previewUrl?: string | null;
	livePins?: Record<number, 0 | 1>;
	arduinoLivePins?: Record<number, 0 | 1>;
	verifyOverlay?: CircuitVerifyOverlay;
	boardModel?: string | null;
	fill?: boolean;
};

type PinInfo = PartPinInfo;

type ZoomCamera = {
	viewportRef: React.RefObject<HTMLDivElement | null>;
	view: Viewport;
	percent: number;
	fit: () => void;
	fitTo: (rect: {
		x: number;
		y: number;
		width: number;
		height: number;
	}) => void;
	zoomBy: (factor: number) => void;
	setView: (update: Viewport | ((current: Viewport) => Viewport)) => void;
	onPointerDown: (event: ReactPointerEvent<HTMLDivElement>) => void;
	onPointerMove: (event: ReactPointerEvent<HTMLDivElement>) => void;
	onPointerUp: (event: ReactPointerEvent<HTMLDivElement>) => void;
	suppressClick: React.RefObject<boolean>;
};

export default function BreadboardViewer({
	diagramText,
	previewUrl,
	livePins,
	arduinoLivePins,
	verifyOverlay,
	boardModel,
	fill = false,
}: Props) {
	const t = useT();
	const parsed = useMemo(() => parseDiagram(diagramText), [diagramText]);
	const diagram = parsed.diagram;
	if (diagram) {
		return (
			<DiagramBoard
				diagram={diagram}
				livePins={livePins}
				arduinoLivePins={arduinoLivePins}
				verifyOverlay={verifyOverlay}
				boardModel={boardModel}
				fill={fill}
			/>
		);
	}

	if (previewUrl) {
		return <PreviewBoard previewUrl={previewUrl} fill={fill} />;
	}

	if (diagramText) {
		return (
			<Paper
				className={fill ? "flex h-full flex-col overflow-hidden p-4" : "p-4"}
				elevation={fill ? 0 : 1}
			>
				<Typography variant="subtitle1" className="mb-2">
					{t("board.breadboard")}
				</Typography>
				{parsed.error ? (
					<Typography color="error" className="mb-2">
						{parsed.error}
					</Typography>
				) : null}
				<pre className="max-h-[32rem] overflow-auto text-xs">
					{diagramText.slice(0, 8000)}
				</pre>
			</Paper>
		);
	}

	return (
		<Paper
			className={
				fill
					? "flex h-full items-center p-4"
					: "workbench-empty project-preview-empty"
			}
			elevation={fill ? 0 : 1}
		>
			<Typography color="secondary">{t("project.noBreadboard")}</Typography>
		</Paper>
	);
}

function DiagramBoard({
	diagram,
	livePins,
	arduinoLivePins,
	verifyOverlay,
	boardModel,
	fill,
}: {
	diagram: WokwiDiagram;
	livePins?: Record<number, 0 | 1>;
	arduinoLivePins?: Record<number, 0 | 1>;
	verifyOverlay?: CircuitVerifyOverlay;
	boardModel?: string | null;
	fill: boolean;
}) {
	const t = useT();
	const [activeStep, setActiveStep] = useState(0);
	const [expanded, setExpanded] = useState(false);
	const [seed, setSeed] = useState<string[] | null>(null);
	const [wireKey, setWireKey] = useState<string | null>(null);
	useEffect(() => {
		void diagram;
		setWireKey(null);
		setSeed(null);
		setActiveStep(0);
	}, [diagram]);
	const [elementsReady, setElementsReady] = useState(0);
	const partRefs = useRef(new Map<string, HTMLElement>());
	const connectionPanelRef = useRef<HTMLDivElement>(null);
	const stepRefs = useRef<(HTMLButtonElement | null)[]>([]);
	const pins = collectPins(diagram, partRefs.current, boardModel);
	const bounds = canvasBounds(diagram, partRefs.current, boardModel);
	const camera = useZoomCamera(bounds.width, bounds.height, expanded, () => {
		setSeed(null);
		setWireKey(null);
	});
	const highlight = seed ?? diagram.steps?.[activeStep]?.highlight ?? [];
	const label = (endpoint: string) =>
		breadboardEndpointLabel(diagram, endpoint, boardModel, {
			physical: t("board.physicalPin"),
			hole: t("board.hole"),
			leftRail: t("board.leftRail"),
			rightRail: t("board.rightRail"),
		});
	const selected = diagram.connections.find(
		([from, to]) => `${from}->${to}` === wireKey,
	);
	const point = (endpoint: string) =>
		endpointPoint(diagram, endpoint, pins, boardModel);
	const focusConnection = () => {
		if (!selected) return;
		const a = point(selected[0]);
		const b = point(selected[1]);
		if (a && b)
			camera.fitTo({
				x: Math.min(a.x, b.x) - 30,
				y: Math.min(a.y, b.y) - 30,
				width: Math.abs(a.x - b.x) + 60,
				height: Math.abs(a.y - b.y) + 60,
			});
	};

	useEffect(() => {
		void import("@wokwi/elements").then(() => {
			setElementsReady((value) => value + 1);
		});
	}, []);

	useEffect(() => {
		if (!expanded) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setExpanded(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [expanded]);

	function selectPart(partId: string) {
		setSeed([partId]);
		setWireKey(null);
	}

	function selectWire(from: string, to: string) {
		connectionPanelRef.current?.scrollTo({ top: 0 });
		setWireKey(`${from}->${to}`);
		setSeed([splitEndpoint(from).partId, splitEndpoint(to).partId]);
	}

	function selectStep(index: number) {
		setActiveStep(index);
		setSeed(null);
		setWireKey(null);
		const ids = diagram.steps?.[index]?.highlight;
		if (ids?.length) {
			camera.fitTo(partsRect(diagram, ids, partRefs.current, boardModel));
		} else {
			camera.fit();
		}
		stepRefs.current[index]?.scrollIntoView({
			block: "nearest",
			inline: "nearest",
		});
	}

	function partNode(part: WokwiPart) {
		if (part.hide) {
			return null;
		}
		return renderPart(
			diagram,
			part,
			partHot(part, highlight),
			livePins,
			arduinoLivePins,
			verifyOverlay?.parts[part.id],
			boardModel,
			partRefs.current.get(part.id),
			(el) => {
				if (el) {
					partRefs.current.set(part.id, el);
				} else {
					partRefs.current.delete(part.id);
				}
			},
			() => selectPart(part.id),
			camera.view.scale,
		);
	}

	return (
		<BoardShell
			camera={camera}
			expanded={expanded}
			fill={fill}
			onToggleExpand={() => setExpanded((value) => !value)}
		>
			<ZoomSurface camera={camera} expanded={expanded} fill={fill}>
				<div
					className="relative"
					style={{
						width: bounds.width * camera.view.scale,
						height: bounds.height * camera.view.scale,
					}}
				>
					{diagram.parts
						.filter((part) => isBreadboardType(part.type))
						.map(partNode)}
					{/* biome-ignore lint/a11y/useSemanticElements: interactive SVG group cannot be an HTML fieldset */}
					<svg
						aria-label={t("board.wiring")}
						className="pointer-events-none absolute left-0 top-0"
						height={bounds.height * camera.view.scale}
						key={elementsReady}
						role="group"
						viewBox={`0 0 ${bounds.width} ${bounds.height}`}
						width={bounds.width * camera.view.scale}
					>
						<title>{t("board.wiring")}</title>
						{diagram.connections.map((connection) => {
							const [from, to, color, instructions] = connection;
							const start = point(from);
							const end = point(to);
							if (!start || !end) {
								return null;
							}
							if (
								Math.hypot(end.x - start.x, end.y - start.y) < 2 &&
								instructions.length === 0
							) {
								return null;
							}
							const points = wirePath(start, end, instructions)
								.map((point) => `${point.x},${point.y}`)
								.join(" ");
							const key = `${from}->${to}`;
							const hot = wireHot(from, to, highlight, wireKey, key);
							const verifyColor = circuitVerifyColor(verifyOverlay?.wires[key]);
							return (
								<g key={key}>
									<polyline
										points={points}
										fill="none"
										stroke="#111827"
										strokeWidth={hot ? 5 : 3}
										strokeOpacity={hot ? 0.85 : 0.3}
										vectorEffect="non-scaling-stroke"
									/>
									<polyline
										points={points}
										fill="none"
										stroke={verifyColor || color || "#22c55e"}
										strokeWidth={hot ? 3 : 2}
										strokeOpacity={hot ? 1 : 0.35}
										vectorEffect="non-scaling-stroke"
									/>
									{/* biome-ignore lint/a11y/useSemanticElements: SVG hit target with equivalent HTML buttons below */}
									<polyline
										key={key}
										aria-label={`${label(from)} ↔ ${label(to)}`}
										aria-pressed={wireKey === key}
										vectorEffect="non-scaling-stroke"
										fill="none"
										onClick={(event) => {
											event.stopPropagation();
											selectWire(from, to);
										}}
										onKeyDown={(event) => {
											if (event.key === "Enter" || event.key === " ") {
												event.preventDefault();
												selectWire(from, to);
											}
										}}
										points={points}
										role="button"
										stroke="transparent"
										strokeOpacity={hot ? 1 : 0.35}
										strokeWidth={16}
										style={{ pointerEvents: "stroke", cursor: "pointer" }}
										tabIndex={0}
									>
										<title>{`${label(from)} ↔ ${label(to)}`}</title>
									</polyline>
								</g>
							);
						})}
					</svg>
					{diagram.parts
						.filter((part) => !isBreadboardType(part.type))
						.map(partNode)}
					{selected ? (
						<svg
							aria-hidden="true"
							className="pointer-events-none absolute left-0 top-0"
							width={bounds.width * camera.view.scale}
							height={bounds.height * camera.view.scale}
							viewBox={`0 0 ${bounds.width} ${bounds.height}`}
						>
							{selected.slice(0, 2).map((endpoint, index) => {
								const p = point(endpoint as string);
								return p ? (
									<g key={endpoint as string}>
										<circle
											cx={p.x}
											cy={p.y}
											r={5}
											fill="none"
											stroke="#111827"
											strokeWidth={5}
											vectorEffect="non-scaling-stroke"
										/>
										<circle
											cx={p.x}
											cy={p.y}
											r={5}
											fill="none"
											stroke="#fff"
											strokeWidth={2}
											vectorEffect="non-scaling-stroke"
										/>
										<text
											x={p.x + 8}
											y={p.y - 8}
											fontSize={12 / camera.view.scale}
											fontWeight={700}
											fill="#fff"
											stroke="#111827"
											strokeWidth={3 / camera.view.scale}
											paintOrder="stroke"
										>
											{index === 0 ? "A" : "B"}:{" "}
											{splitEndpoint(endpoint as string).pin}
										</text>
									</g>
								) : null;
							})}
						</svg>
					) : null}
				</div>
			</ZoomSurface>
			<div
				ref={connectionPanelRef}
				style={{
					flexShrink: 0,
					maxHeight: expanded || fill ? "30%" : 220,
					display: "flex",
					flexDirection: "column",
					overflowY: "auto",
					paddingTop: 8,
				}}
			>
				<details style={{ order: 1, flexShrink: 0 }}>
					<summary style={{ cursor: "pointer", padding: "8px 0" }}>
						{t("board.connections")} ({diagram.connections.length})
					</summary>
					<Typography variant="caption" color="secondary">
						{t("board.connectionHint")}
						<br />
						{t("board.headerMap")}
					</Typography>
					{diagram.connections.map(([from, to, color], index) => (
						<button
							key={`${from}->${to}`}
							type="button"
							aria-pressed={wireKey === `${from}->${to}`}
							onClick={() => selectWire(from, to)}
							style={{
								display: "block",
								width: "100%",
								minHeight: 44,
								textAlign: "left",
								padding: 8,
								marginTop: 4,
								color: "rgb(var(--text-primary))",
								background:
									wireKey === `${from}->${to}`
										? "rgba(var(--text-primary),0.12)"
										: "transparent",
								border: "1px solid rgba(var(--text-primary),0.25)",
								borderRadius: 6,
								overflowWrap: "anywhere",
							}}
						>
							<span
								aria-hidden="true"
								style={{
									display: "inline-block",
									width: 12,
									height: 12,
									background: color || "#22c55e",
									border: "1px solid currentColor",
									marginRight: 8,
								}}
							/>
							{index + 1}. A: {label(from)} ↔ B: {label(to)}
							{!point(from) || !point(to) ? (
								<span style={{ display: "block" }}>
									{t("board.unresolved")} ({!point(from) ? from : to})
								</span>
							) : null}
						</button>
					))}
				</details>
				{selected ? (
					<div
						role="status"
						style={{
							order: 0,
							flexShrink: 0,
							padding: "8px 0",
							overflowWrap: "anywhere",
						}}
					>
						<div>A: {label(selected[0])}</div>
						<div>B: {label(selected[1])}</div>
						<button
							type="button"
							onClick={focusConnection}
							disabled={!point(selected[0]) || !point(selected[1])}
							style={{ minHeight: 44, padding: 8 }}
						>
							{t("board.focusConnection")}
						</button>
					</div>
				) : null}
			</div>
			{diagram.steps?.length ? (
				<div
					className={
						expanded || fill
							? "mt-3 min-h-0 max-h-[min(40vh,16rem)] shrink-0 overflow-y-auto overscroll-contain"
							: "mt-3"
					}
				>
					<Stack spacing={1}>
						{diagram.steps.map((step, index) => (
							<button
								key={step.text}
								className={`whitespace-normal rounded px-3 py-2 text-left text-sm [overflow-wrap:anywhere] breadboard-step ${
									index === activeStep ? "is-active" : ""
								}`}
								onClick={() => selectStep(index)}
								ref={(el) => {
									stepRefs.current[index] = el;
								}}
								type="button"
							>
								{index + 1}. {step.text}
							</button>
						))}
					</Stack>
				</div>
			) : null}
		</BoardShell>
	);
}

function PreviewBoard({
	previewUrl,
	fill,
}: {
	previewUrl: string;
	fill: boolean;
}) {
	const t = useT();
	const [expanded, setExpanded] = useState(false);
	const [natural, setNatural] = useState({ width: 800, height: 600 });
	const camera = useZoomCamera(natural.width, natural.height, expanded);

	useEffect(() => {
		if (!expanded) {
			return;
		}
		const onKey = (event: KeyboardEvent) => {
			if (event.key === "Escape") {
				setExpanded(false);
			}
		};
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [expanded]);

	return (
		<BoardShell
			camera={camera}
			expanded={expanded}
			fill={fill}
			onToggleExpand={() => setExpanded((value) => !value)}
		>
			<ZoomSurface camera={camera} expanded={expanded} fill={fill}>
				<img
					alt={t("board.previewAlt")}
					height={natural.height * camera.view.scale}
					onLoad={(event) => {
						const image = event.currentTarget;
						if (image.naturalWidth > 0 && image.naturalHeight > 0) {
							setNatural({
								width: image.naturalWidth,
								height: image.naturalHeight,
							});
						}
					}}
					src={previewUrl}
					width={natural.width * camera.view.scale}
				/>
			</ZoomSurface>
		</BoardShell>
	);
}

function BoardShell({
	camera,
	expanded,
	fill,
	onToggleExpand,
	children,
}: {
	camera: ZoomCamera;
	expanded: boolean;
	fill: boolean;
	onToggleExpand: () => void;
	children: ReactNode;
}) {
	const t = useT();
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
					{t("board.breadboard")}
				</Typography>
				<Typography color="secondary" variant="caption">
					{camera.percent}%
				</Typography>
				<IconButton
					aria-label={t("board.zoomOut")}
					color="secondary"
					onClick={() => camera.zoomBy(1 / 1.25)}
					size="small"
				>
					<ZoomOutIcon fill="currentColor" />
				</IconButton>
				<IconButton
					aria-label={t("board.zoomIn")}
					color="secondary"
					onClick={() => camera.zoomBy(1.25)}
					size="small"
				>
					<ZoomInIcon fill="currentColor" />
				</IconButton>
				<IconButton
					aria-label={t("board.fit")}
					color="secondary"
					onClick={() => camera.fit()}
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
						onClick={onToggleExpand}
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
			{children}
		</Paper>
	);
}

function ZoomSurface({
	camera,
	expanded,
	fill,
	children,
}: {
	camera: ZoomCamera;
	expanded: boolean;
	fill: boolean;
	children: ReactNode;
}) {
	const t = useT();
	useEffect(() => {
		const el = camera.viewportRef.current;
		if (!el) {
			return;
		}
		const onWheel = (event: WheelEvent) => {
			if (!event.ctrlKey && !event.metaKey) {
				return;
			}
			event.preventDefault();
			const rect = el.getBoundingClientRect();
			camera.setView((current) =>
				zoomAt(
					current,
					event.deltaY < 0 ? 1.12 : 1 / 1.12,
					event.clientX - rect.left,
					event.clientY - rect.top,
				),
			);
		};
		el.addEventListener("wheel", onWheel, { passive: false });
		return () => el.removeEventListener("wheel", onWheel);
	}, [camera]);

	return (
		// biome-ignore lint/a11y/useSemanticElements: zoom camera requires the same div ref and pointer target
		<div
			aria-label={t("board.canvas")}
			className={`relative breadboard-canvas min-h-0 touch-none overflow-hidden ${
				expanded || fill ? "flex-1" : "h-[320px] min-[900px]:h-[520px]"
			}`}
			onDoubleClick={() => camera.fit()}
			onClickCapture={(event) => {
				if (camera.suppressClick.current) {
					event.preventDefault();
					event.stopPropagation();
				}
			}}
			onPointerDown={camera.onPointerDown}
			onPointerMove={camera.onPointerMove}
			onPointerUp={camera.onPointerUp}
			onPointerCancel={camera.onPointerUp}
			ref={camera.viewportRef}
			role="region"
			style={{ cursor: "grab" }}
		>
			<div
				style={{
					transform: `translate(${camera.view.x}px, ${camera.view.y}px)`,
					transformOrigin: "0 0",
					width: "max-content",
				}}
			>
				{children}
			</div>
		</div>
	);
}

function useZoomCamera(
	contentWidth: number,
	contentHeight: number,
	resetKey: boolean,
	onBackgroundClick?: () => void,
): ZoomCamera {
	const viewportRef = useRef<HTMLDivElement>(null);
	const [view, setView] = useState<Viewport>({ scale: 1, x: 0, y: 0 });
	const viewRef = useRef(view);
	viewRef.current = view;
	const drag = useRef<{
		x: number;
		y: number;
		startX: number;
		startY: number;
		moved: boolean;
	} | null>(null);
	const pointers = useRef(new Map<number, { x: number; y: number }>());
	const suppressClick = useRef(false);
	const pinch = useRef<{
		distance: number;
		view: Viewport;
	} | null>(null);
	const click = useRef(onBackgroundClick);
	click.current = onBackgroundClick;

	const fit = useCallback(() => {
		const el = viewportRef.current;
		setView(
			fitContain(
				contentWidth,
				contentHeight,
				el?.clientWidth ?? 0,
				el?.clientHeight ?? 0,
			),
		);
	}, [contentWidth, contentHeight]);

	const fitTo = useCallback(
		(rect: { x: number; y: number; width: number; height: number }) => {
			const el = viewportRef.current;
			setView(fitRect(rect, el?.clientWidth ?? 0, el?.clientHeight ?? 0, 32));
		},
		[],
	);

	const zoomBy = useCallback((factor: number) => {
		const el = viewportRef.current;
		const w = el?.clientWidth ?? 0;
		const h = el?.clientHeight ?? 0;
		setView((current) => zoomAt(current, factor, w / 2, h / 2));
	}, []);

	useLayoutEffect(() => {
		void resetKey;
		fit();
	}, [fit, resetKey]);

	const onPointerDown = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			suppressClick.current = false;
			// Preserve taps on child controls; capture only a background drag.
			if (event.target === event.currentTarget)
				event.currentTarget.setPointerCapture(event.pointerId);
			pointers.current.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY,
			});
			if (pointers.current.size === 1) {
				drag.current = {
					x: event.clientX,
					y: event.clientY,
					startX: event.clientX,
					startY: event.clientY,
					moved: false,
				};
				pinch.current = null;
				event.currentTarget.style.cursor = "grabbing";
			} else {
				drag.current = null;
				const pts = [...pointers.current.values()];
				if (!pts[0] || !pts[1]) return;
				suppressClick.current = true;
				pinch.current = {
					distance: Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1,
					view: viewRef.current,
				};
			}
		},
		[],
	);

	const onPointerMove = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			if (!pointers.current.has(event.pointerId)) {
				return;
			}
			pointers.current.set(event.pointerId, {
				x: event.clientX,
				y: event.clientY,
			});
			if (pointers.current.size === 2 && pinch.current) {
				const pts = [...pointers.current.values()];
				if (!pts[0] || !pts[1]) return;
				const distance =
					Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y) || 1;
				const rect = event.currentTarget.getBoundingClientRect();
				const originX = (pts[0].x + pts[1].x) / 2 - rect.left;
				const originY = (pts[0].y + pts[1].y) / 2 - rect.top;
				setView(
					zoomAt(
						pinch.current.view,
						distance / pinch.current.distance,
						originX,
						originY,
					),
				);
				return;
			}
			const active = drag.current;
			if (!active) {
				return;
			}
			const dx = event.clientX - active.x;
			const dy = event.clientY - active.y;
			if (
				Math.hypot(
					event.clientX - active.startX,
					event.clientY - active.startY,
				) > 4
			) {
				active.moved = true;
				suppressClick.current = true;
				event.currentTarget.setPointerCapture(event.pointerId);
			}
			active.x = event.clientX;
			active.y = event.clientY;
			setView((current) => panBy(current, dx, dy));
		},
		[],
	);

	const onPointerUp = useCallback(
		(event: ReactPointerEvent<HTMLDivElement>) => {
			pointers.current.delete(event.pointerId);
			if (pointers.current.size < 2) {
				pinch.current = null;
			}
			if (pointers.current.size === 0) {
				event.currentTarget.style.cursor = "grab";
				const active = drag.current;
				drag.current = null;
				if (active && !active.moved && event.target === event.currentTarget) {
					click.current?.();
				}
			}
		},
		[],
	);

	return useMemo(
		() => ({
			viewportRef,
			suppressClick,
			view,
			percent: Math.round(view.scale * 100),
			fit,
			fitTo,
			zoomBy,
			setView,
			onPointerDown,
			onPointerMove,
			onPointerUp,
		}),
		[view, fit, fitTo, zoomBy, onPointerDown, onPointerMove, onPointerUp],
	);
}

function parseDiagram(text?: string | null): {
	diagram: WokwiDiagram | null;
	error: string | null;
} {
	if (!text?.trim()) {
		return { diagram: null, error: null };
	}
	try {
		return { diagram: parseWokwiDiagram(text), error: null };
	} catch (error) {
		return {
			diagram: null,
			error: error instanceof Error ? error.message : "invalid diagram",
		};
	}
}

function elementPins(el?: HTMLElement): PartPinInfo[] | undefined {
	const pins = (el as (HTMLElement & { pinInfo?: PinInfo[] }) | undefined)
		?.pinInfo;
	return pins?.length ? pins : undefined;
}

function partHot(part: WokwiPart, highlight: string[]): boolean {
	if (isBreadboardType(part.type)) {
		return true;
	}
	return highlight.length === 0 || highlight.includes(part.id);
}

function wireHot(
	from: string,
	to: string,
	highlight: string[],
	wireKey: string | null,
	key: string,
): boolean {
	if (wireKey) {
		return wireKey === key;
	}
	if (highlight.length === 0) {
		return true;
	}
	return (
		highlight.includes(splitEndpoint(from).partId) ||
		highlight.includes(splitEndpoint(to).partId)
	);
}

function renderPart(
	diagram: WokwiDiagram,
	part: WokwiPart,
	hot: boolean,
	livePins: Record<number, 0 | 1> | undefined,
	arduinoLivePins: Record<number, 0 | 1> | undefined,
	verifyStatus: CircuitVerifyStatus | undefined,
	boardModel: string | null | undefined,
	el: HTMLElement | undefined,
	ref: (el: HTMLElement | null) => void,
	onSelect: () => void,
	scale: number,
) {
	const placement = snapPartPlacement(part, diagram, elementPins(el));
	const style: CSSProperties = {
		position: "absolute",
		left: placement.origin.x * scale,
		top: placement.origin.y * scale,
		transform: placement.rotate ? `rotate(${placement.rotate}deg)` : undefined,
		transformOrigin: "top left",
		opacity: hot ? 1 : 0.35,
		cursor: isBreadboardType(part.type) ? "default" : "pointer",
		outline: circuitVerifyColor(verifyStatus)
			? `2px solid ${circuitVerifyColor(verifyStatus)}`
			: undefined,
		outlineOffset: 2,
	};
	if (isBreadboardType(part.type)) {
		return (
			<div key={part.id} style={style}>
				<BreadboardSvg scale={scale} type={part.type} />
			</div>
		);
	}
	if (part.type === GPIO_COMPANION_HEADER_TYPE) {
		return (
			<button
				key={part.id}
				onClick={(event) => {
					event.stopPropagation();
					onSelect();
				}}
				style={{ ...style, border: 0, background: "transparent", padding: 0 }}
				type="button"
			>
				<HeaderSvg
					boardModel={boardModel}
					hardware={part.attrs?.hardware ?? "raspberrypi"}
					livePins={livePins}
					scale={scale}
				/>
			</button>
		);
	}
	if (isArduinoProxyPartType(part.type)) {
		return (
			<button
				key={part.id}
				onClick={(event) => {
					event.stopPropagation();
					onSelect();
				}}
				style={{ ...style, border: 0, background: "transparent", padding: 0 }}
				type="button"
			>
				<ArduinoProxySvg
					board={part.attrs?.board ?? "uno"}
					livePins={arduinoLivePins}
					scale={scale}
				/>
			</button>
		);
	}
	return (
		<div key={part.id} style={style}>
			<button
				onClick={(event) => {
					event.stopPropagation();
					onSelect();
				}}
				style={{
					border: 0,
					background: "transparent",
					padding: 0,
					cursor: "pointer",
					zoom: scale,
				}}
				type="button"
			>
				{createElement(part.type, {
					ref,
					id: part.id,
					...part.attrs,
				})}
			</button>
		</div>
	);
}

function BreadboardSvg({ type, scale = 1 }: { type: string; scale?: number }) {
	const t = useT();
	const { width, height } = breadboardSize(type);
	const rows = breadboardRows(type);
	const holes: Point[] = [];
	for (const pin of breadboardPinNames(type)) {
		const point = breadboardPinOffset(type, pin);
		if (point) {
			holes.push(point);
		}
	}
	const first = breadboardPinOffset(type, "1a");
	const last = breadboardPinOffset(type, `${rows}e`);
	const colF = breadboardPinOffset(type, "1f");
	const grooveLeft = last ? last.x + BREADBOARD_PITCH * 0.6 : 0;
	const grooveRight = colF ? colF.x - BREADBOARD_PITCH * 0.6 : 0;
	const grooveTop = first ? first.y - BREADBOARD_PITCH * 0.6 : 0;
	const grooveBottom = last ? last.y + BREADBOARD_PITCH * 0.6 : 0;
	const labelY = BREADBOARD_PITCH * 1.15;
	return (
		<svg
			aria-label={t("board.breadboard")}
			height={height * scale}
			role="img"
			viewBox={`0 0 ${width} ${height}`}
			width={width * scale}
		>
			<title>{t("board.breadboard")}</title>
			<rect width={width} height={height} fill="#d6c7a1" rx={6} />
			{grooveRight > grooveLeft ? (
				<rect
					x={grooveLeft}
					y={grooveTop}
					width={grooveRight - grooveLeft}
					height={grooveBottom - grooveTop}
					fill="#c4b48e"
					rx={2}
				/>
			) : null}
			{breadboardHasRails(type)
				? BREADBOARD_RAILS.map((rail) => {
						const top = breadboardPinOffset(type, `${rail}.1`);
						const bottom = breadboardPinOffset(type, `${rail}.${rows}`);
						if (!top || !bottom) {
							return null;
						}
						const positive = rail.endsWith("p");
						return (
							<line
								key={`${rail}-line`}
								x1={top.x}
								y1={top.y - 4}
								x2={bottom.x}
								y2={bottom.y + 4}
								stroke={positive ? "#c24141" : "#3b6ea5"}
								strokeWidth={1.2}
							/>
						);
					})
				: null}
			{holes.map((hole) => (
				<circle
					key={`${hole.x}-${hole.y}`}
					cx={hole.x}
					cy={hole.y}
					r={2}
					fill="#1e293b"
				/>
			))}
			{[...BREADBOARD_LEFT_COLS, ...BREADBOARD_RIGHT_COLS].map((col) => {
				const point = breadboardPinOffset(type, `1${col}`);
				if (!point) {
					return null;
				}
				return (
					<text
						key={`col-${col}`}
						x={point.x}
						y={labelY}
						fill="#5b4f3a"
						fontSize={7}
						textAnchor="middle"
					>
						{col}
					</text>
				);
			})}
			{Array.from({ length: rows }, (_, index) => index + 1)
				.filter((row) => row === 1 || row === rows || row % 5 === 0)
				.map((row) => {
					const point = breadboardPinOffset(type, `${row}a`);
					if (!point) {
						return null;
					}
					return (
						<text
							key={`row-${row}`}
							x={(grooveLeft + grooveRight) / 2}
							y={point.y + 2.5}
							fill="#5b4f3a"
							fontSize={7}
							textAnchor="middle"
						>
							{row}
						</text>
					);
				})}
			{breadboardHasRails(type)
				? (
						[
							["tp", "+", "#c24141"],
							["tn", "−", "#3b6ea5"],
							["bn", "−", "#3b6ea5"],
							["bp", "+", "#c24141"],
						] as const
					).map(([rail, mark, fill]) => {
						const point = breadboardPinOffset(type, `${rail}.1`);
						if (!point) {
							return null;
						}
						return (
							<text
								key={`${rail}-mark`}
								x={point.x}
								y={labelY}
								fill={fill}
								fontSize={8}
								fontWeight={700}
								textAnchor="middle"
							>
								{mark}
							</text>
						);
					})
				: null}
		</svg>
	);
}

function headerDefs(hardware: string, model?: string | null): HeaderPinDef[] {
	const id = isHardwareId(hardware) ? hardware : "raspberrypi";
	return headerPinsForBoard(id, model ?? undefined);
}

function headerFill(
	pin: HeaderPinDef,
	livePins?: Record<number, 0 | 1>,
): string {
	if (pin.type === "power") {
		return pin.name === "5V" ? "#ef4444" : "#fbbf24";
	}
	if (pin.type === "gnd") {
		return "#334155";
	}
	if (livePins?.[pin.physical] === 1) {
		return "#22c55e";
	}
	if (livePins?.[pin.physical] === 0) {
		return "#475569";
	}
	return "#e2e8f0";
}

function headerLabelFill(pin: HeaderPinDef): string {
	if (pin.type === "power") {
		return pin.name === "5V" ? "#fca5a5" : "#fcd34d";
	}
	if (pin.type === "gnd") {
		return "#94a3b8";
	}
	return "#cbd5e1";
}

function HeaderSvg({
	hardware,
	boardModel,
	livePins,
	scale = 1,
}: {
	hardware: string;
	boardModel?: string | null;
	livePins?: Record<number, 0 | 1>;
	scale?: number;
}) {
	const t = useT();
	const pins = headerDefs(hardware, boardModel);
	const { width, height } = headerSize(pins.length);
	return (
		<svg
			aria-label={t("gpio.headerAria", { hardware })}
			height={height * scale}
			role="img"
			viewBox={`0 0 ${width} ${height}`}
			width={width * scale}
		>
			<title>{t("gpio.headerAria", { hardware })}</title>
			<rect width={width} height={height} fill="#111827" rx={4} />
			<text x={4} y={10} fill="#94a3b8" fontSize={8}>
				{hardware === "orangepi" ? "Orange Pi" : "Raspberry Pi"}
			</text>
			<path
				d={`M ${(headerPinOffset("1", pins.length)?.x ?? 48) - 4} 14 l 4 0 l -4 4 Z`}
				fill="#fbbf24"
			>
				<title>{t("board.physicalPin")} 1</title>
			</path>
			{pins.map((pin) => {
				const point = headerPinOffset(String(pin.physical), pins.length);
				if (!point) {
					return null;
				}
				const odd = pin.physical % 2 === 1;
				return (
					<g key={pin.physical}>
						<circle
							cx={point.x}
							cy={point.y}
							r={2.2}
							fill={headerFill(pin, livePins)}
							stroke={pin.type === "gnd" ? "#94a3b8" : "none"}
							strokeWidth={0.6}
						/>
						<text
							x={odd ? point.x - 5 : point.x + 5}
							y={point.y + 2.4}
							fill={headerLabelFill(pin)}
							fontSize={6}
							textAnchor={odd ? "end" : "start"}
						>
							{odd
								? `${pin.name} ${pin.physical}`
								: `${pin.physical} ${pin.name}`}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

function arduinoPadFill(
	kind: string,
	label: string,
	physical: number | undefined,
	livePins?: Record<number, 0 | 1>,
): string {
	if (kind === "power") {
		return /5v|vin/i.test(label) ? "#ef4444" : "#fbbf24";
	}
	if (kind === "gnd") {
		return "#334155";
	}
	if (typeof physical === "number" && livePins?.[physical] === 1) {
		return "#22c55e";
	}
	if (typeof physical === "number" && livePins?.[physical] === 0) {
		return "#475569";
	}
	return "#e2e8f0";
}

function ArduinoProxySvg({
	board,
	livePins,
	scale = 1,
}: {
	board: string;
	livePins?: Record<number, 0 | 1>;
	scale?: number;
}) {
	const t = useT();
	const layout = arduinoProxyBoardLayout(board);
	const title = arduinoProxyBoardTitle(board);
	return (
		<svg
			aria-label={t("board.headerAria", { title })}
			height={layout.height * scale}
			role="img"
			viewBox={`0 0 ${layout.width} ${layout.height}`}
			width={layout.width * scale}
		>
			<title>{title}</title>
			<rect width={layout.width} height={layout.height} fill="#111827" rx={4} />
			<text
				x={layout.width / 2}
				y={10}
				fill="#94a3b8"
				fontSize={8}
				textAnchor="middle"
			>
				USB
			</text>
			<text x={4} y={20} fill="#94a3b8" fontSize={7}>
				{title}
			</text>
			{layout.pads.map((pad) => {
				const point = arduinoProxyPadOffset(board, pad);
				const left = pad.column === "left";
				return (
					<g key={`${pad.column}-${pad.row}-${pad.name}`}>
						<circle
							cx={point.x}
							cy={point.y}
							r={2.2}
							fill={arduinoPadFill(pad.kind, pad.label, pad.physical, livePins)}
							stroke={pad.kind === "gnd" ? "#94a3b8" : "none"}
							strokeWidth={0.6}
						/>
						<text
							x={left ? point.x - 5 : point.x + 5}
							y={point.y + 2.4}
							fill={
								pad.kind === "power"
									? /5v|vin/i.test(pad.label)
										? "#fca5a5"
										: "#fcd34d"
									: pad.kind === "gnd"
										? "#94a3b8"
										: "#cbd5e1"
							}
							fontSize={6}
							textAnchor={left ? "end" : "start"}
						>
							{pad.label}
						</text>
					</g>
				);
			})}
		</svg>
	);
}

function collectPins(
	diagram: WokwiDiagram,
	refs: Map<string, HTMLElement>,
	boardModel?: string | null,
): Map<string, Point> {
	const pins = new Map<string, Point>();
	for (const part of diagram.parts) {
		const placement = snapPartPlacement(
			part,
			diagram,
			elementPins(refs.get(part.id)),
		);
		const origin = placement.origin;
		const rotate = placement.rotate;
		if (isBreadboardType(part.type)) {
			for (const pin of breadboardPinNames(part.type)) {
				addOffsetPin(pins, part, pin, origin, rotate, (name) =>
					breadboardPinOffset(part.type, name),
				);
			}
			continue;
		}
		if (part.type === GPIO_COMPANION_HEADER_TYPE) {
			const count = headerDefs(
				part.attrs?.hardware ?? "raspberrypi",
				boardModel,
			).length;
			for (let pin = 1; pin <= count; pin += 1) {
				addOffsetPin(pins, part, String(pin), origin, rotate, (name) =>
					headerPinOffset(name, count),
				);
			}
			continue;
		}
		if (isArduinoProxyPartType(part.type)) {
			const board = part.attrs?.board ?? "uno";
			const layout = arduinoProxyBoardLayout(board);
			for (const pad of layout.pads) {
				const offset = arduinoProxyPadOffset(board, pad);
				const rotated = rotatePoint(offset, rotate);
				const point = {
					x: origin.x + rotated.x,
					y: origin.y + rotated.y,
				};
				for (const name of [pad.name, ...pad.aliases]) {
					pins.set(`${part.id}:${name}`, point);
				}
			}
			continue;
		}
		for (const info of partPinsFor(part.type, elementPins(refs.get(part.id)))) {
			const offset = rotatePoint({ x: info.x, y: info.y }, rotate);
			pins.set(`${part.id}:${info.name}`, {
				x: origin.x + offset.x,
				y: origin.y + offset.y,
			});
		}
	}
	return pins;
}

function addOffsetPin(
	pins: Map<string, Point>,
	part: WokwiPart,
	pin: string,
	origin: Point,
	rotate: number,
	offsetOf: (pin: string) => Point | null,
) {
	const offset = offsetOf(pin);
	if (!offset) {
		return;
	}
	const rotated = rotatePoint(offset, rotate);
	pins.set(`${part.id}:${pin}`, {
		x: origin.x + rotated.x,
		y: origin.y + rotated.y,
	});
}

function endpointPoint(
	diagram: WokwiDiagram,
	endpoint: string,
	pins: Map<string, Point>,
	boardModel?: string | null,
): Point | null {
	const direct = pins.get(endpoint);
	if (direct) {
		return direct;
	}
	const { partId } = splitEndpoint(endpoint);
	const part = diagram.parts.find((item) => item.id === partId);
	if (!part) {
		return null;
	}
	return resolveBreadboardEndpoint(diagram, endpoint, boardModel);
}

function partSize(
	part: WokwiPart,
	boardModel?: string | null,
): { width: number; height: number } {
	if (isBreadboardType(part.type)) {
		return breadboardSize(part.type);
	}
	if (part.type === GPIO_COMPANION_HEADER_TYPE) {
		return headerSize(
			headerDefs(part.attrs?.hardware ?? "raspberrypi", boardModel).length,
		);
	}
	if (isArduinoProxyPartType(part.type)) {
		return arduinoProxyBoardSize(part.attrs?.board ?? "uno");
	}
	return { width: 80, height: 80 };
}

function partsRect(
	diagram: WokwiDiagram,
	ids: string[],
	refs: Map<string, HTMLElement>,
	boardModel?: string | null,
): { x: number; y: number; width: number; height: number } {
	let minX = Number.POSITIVE_INFINITY;
	let minY = Number.POSITIVE_INFINITY;
	let maxX = Number.NEGATIVE_INFINITY;
	let maxY = Number.NEGATIVE_INFINITY;
	for (const part of diagram.parts) {
		if (!ids.includes(part.id)) {
			continue;
		}
		const origin = snapPartPlacement(
			part,
			diagram,
			elementPins(refs.get(part.id)),
		).origin;
		const size = partSize(part, boardModel);
		minX = Math.min(minX, origin.x);
		minY = Math.min(minY, origin.y);
		maxX = Math.max(maxX, origin.x + size.width);
		maxY = Math.max(maxY, origin.y + size.height);
	}
	if (!Number.isFinite(minX)) {
		return { x: 0, y: 0, width: 1, height: 1 };
	}
	return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function canvasBounds(
	diagram: WokwiDiagram,
	refs: Map<string, HTMLElement>,
	boardModel?: string | null,
): {
	width: number;
	height: number;
} {
	let width = 320;
	let height = 240;
	for (const part of diagram.parts) {
		const placement = snapPartPlacement(
			part,
			diagram,
			elementPins(refs.get(part.id)),
		);
		const origin = placement.origin;
		const size = partSize(part, boardModel);
		width = Math.max(width, origin.x + size.width + 24);
		height = Math.max(height, origin.y + size.height + 24);
	}
	return { width, height };
}
