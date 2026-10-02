import {
	breadboardPinOffset,
	GPIO_COMPANION_HEADER_TYPE,
	headerPinOffset,
	isBreadboardType,
	type PartPinInfo,
	type Point,
	partPinsFor,
	rotatePoint,
	snapPartPlacement,
	splitEndpoint,
	type WokwiDiagram,
} from "./breadboard.ts";
import {
	arduinoProxyBoardTitle,
	arduinoProxyPinOffset,
	arduinoProxyResolvePad,
	isArduinoProxyPartType,
} from "./breadboard-arduino.ts";
import { isHardwareId } from "./config.ts";
import { headerPinsForBoard } from "./gpio.ts";

export function resolveBreadboardEndpoint(
	diagram: WokwiDiagram,
	endpoint: string,
	model?: string | null,
	elementPins?: PartPinInfo[],
): Point | null {
	const { partId, pin } = splitEndpoint(endpoint);
	const part = diagram.parts.find((item) => item.id === partId);
	if (!part || part.hide) return null;
	let offset: Point | null = null;
	if (isBreadboardType(part.type)) offset = breadboardPinOffset(part.type, pin);
	else if (part.type === GPIO_COMPANION_HEADER_TYPE) {
		const hardware = part.attrs?.hardware;
		const defs = headerPinsForBoard(
			isHardwareId(hardware) ? hardware : "raspberrypi",
			model ?? undefined,
		);
		offset = headerPinOffset(pin, defs.length);
	} else if (isArduinoProxyPartType(part.type))
		offset = arduinoProxyPinOffset(part.attrs?.board, pin);
	else {
		const info = partPinsFor(part.type, elementPins).find(
			(item) => item.name === pin,
		);
		if (info) offset = { x: info.x, y: info.y };
	}
	if (!offset) return null;
	const placement = snapPartPlacement(part, diagram, elementPins);
	const rotated = rotatePoint(offset, placement.rotate);
	return {
		x: placement.origin.x + rotated.x,
		y: placement.origin.y + rotated.y,
	};
}

export function breadboardEndpointLabel(
	diagram: WokwiDiagram,
	endpoint: string,
	model: string | null | undefined,
	words: {
		physical: string;
		hole: string;
		leftRail: string;
		rightRail: string;
	},
): string {
	const { partId, pin } = splitEndpoint(endpoint);
	const part = diagram.parts.find((item) => item.id === partId);
	if (!part) return endpoint;
	if (isBreadboardType(part.type)) {
		const rail = pin.match(/^([tb])([pn])\.(\d+)$/i);
		return rail
			? `${partId} · ${rail[1]?.toLowerCase() === "t" ? words.leftRail : words.rightRail} ${rail[2]?.toLowerCase() === "p" ? "+" : "−"} · ${words.hole} ${rail[3]}`
			: `${partId} · ${words.hole} ${pin.toLowerCase()}`;
	}
	if (part.type === GPIO_COMPANION_HEADER_TYPE) {
		const hardware = part.attrs?.hardware;
		const defs = headerPinsForBoard(
			isHardwareId(hardware) ? hardware : "raspberrypi",
			model ?? undefined,
		);
		const def = defs.find((item) => item.physical === Number(pin));
		return `${model || (hardware === "orangepi" ? "Orange Pi" : "Raspberry Pi")} (${partId}) · ${words.physical} ${pin}${def ? ` (${def.name})` : ""}`;
	}
	if (isArduinoProxyPartType(part.type)) {
		const pad = arduinoProxyResolvePad(part.attrs?.board, pin);
		return `${arduinoProxyBoardTitle(part.attrs?.board)} (${partId}) · ${pad?.label ?? pin}`;
	}
	return `${partId} · ${pin}`;
}
