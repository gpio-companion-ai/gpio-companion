import { describe, expect, test } from "bun:test";
import {
	ANDROID_BLE_CONNECT,
	ANDROID_BLE_SCAN,
	ANDROID_FINE_LOCATION,
	androidBlePermissions,
	BLE_PERMISSION_DENIED,
	mapBleUnauthorized,
} from "./ble-permissions.ts";

describe("androidBlePermissions", () => {
	test("pre-31 needs location only", () => {
		expect(androidBlePermissions(30)).toEqual([ANDROID_FINE_LOCATION]);
	});

	test("API 31+ needs scan, connect, and location", () => {
		expect(androidBlePermissions(31)).toEqual([
			ANDROID_BLE_SCAN,
			ANDROID_BLE_CONNECT,
			ANDROID_FINE_LOCATION,
		]);
		expect(androidBlePermissions(33)).toEqual([
			ANDROID_BLE_SCAN,
			ANDROID_BLE_CONNECT,
			ANDROID_FINE_LOCATION,
		]);
	});
});

describe("mapBleUnauthorized", () => {
	test("rewrites ble-plx unauthorized", () => {
		expect(
			mapBleUnauthorized("Device is not authorized to use BluetoothLE"),
		).toBe(BLE_PERMISSION_DENIED);
	});

	test("leaves other messages alone", () => {
		expect(mapBleUnauthorized("no gpio-companion board found nearby")).toBe(
			"no gpio-companion board found nearby",
		);
	});
});
