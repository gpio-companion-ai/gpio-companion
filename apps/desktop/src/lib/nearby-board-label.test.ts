import { describe, expect, test } from "bun:test";
import { type NearbyBoard, nearbyBoardLabel } from "../api";

function board(
	partial: Partial<NearbyBoard> & Pick<NearbyBoard, "id">,
): NearbyBoard {
	return {
		name: "",
		rssi: null,
		matched: false,
		...partial,
	};
}

describe("nearbyBoardLabel", () => {
	test("matched gpio-companion uses name and hardware", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "C5:4E:5C:2B:26:02",
					name: "gpio-companion",
					matched: true,
					hardware: "orangepi",
				}),
			),
		).toBe("gpio-companion (orangepi)");
	});

	test("matched empty name is gpio-companion, not MAC", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "C5:4E:5C:2B:26:02",
					matched: true,
					pairingUuid: "abcdef12-3456-7890",
				}),
			),
		).toBe("gpio-companion (abcdef12)");
	});

	test("unmatched named radio uses BLE name, not MAC", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "AA:AA:AA:AA:AA:AA",
					name: "orangepi3-lts",
					rssi: -42,
				}),
			),
		).toBe("orangepi3-lts (-42 dBm)");
	});

	test("anonymous unmatched is Nearby radio plus RSSI", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "42:B3:EF:4C:5B:CD",
					rssi: -42,
				}),
			),
		).toBe("Nearby radio (-42 dBm)");
	});

	test("MAC-as-name is treated as anonymous", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "1E:52:1E:18:26:4B",
					name: "1E-52-1E-18-26-4B",
					rssi: -51,
				}),
			),
		).toBe("Nearby radio (-51 dBm)");
	});

	test("anonymous without RSSI has no MAC", () => {
		expect(
			nearbyBoardLabel(
				board({
					id: "42:B3:EF:4C:5B:CD",
				}),
			),
		).toBe("Nearby radio");
	});
});
