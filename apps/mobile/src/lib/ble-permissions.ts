export const ANDROID_BLE_SCAN = "android.permission.BLUETOOTH_SCAN";
export const ANDROID_BLE_CONNECT = "android.permission.BLUETOOTH_CONNECT";
export const ANDROID_FINE_LOCATION = "android.permission.ACCESS_FINE_LOCATION";
export const ANDROID_BLE_API_31 = 31;

export const BLE_PERMISSION_DENIED =
	"Bluetooth permission denied — allow Nearby devices and Location in Android settings";

export type AndroidBlePermission =
	| typeof ANDROID_BLE_SCAN
	| typeof ANDROID_BLE_CONNECT
	| typeof ANDROID_FINE_LOCATION;

export function androidBlePermissions(
	apiLevel: number,
): AndroidBlePermission[] {
	if (apiLevel >= ANDROID_BLE_API_31) {
		return [ANDROID_BLE_SCAN, ANDROID_BLE_CONNECT, ANDROID_FINE_LOCATION];
	}
	return [ANDROID_FINE_LOCATION];
}

export function mapBleUnauthorized(message: string): string {
	if (
		message.includes("Device is not authorized to use BluetoothLE") ||
		message.includes("BluetoothUnauthorized")
	) {
		return BLE_PERMISSION_DENIED;
	}
	return message;
}
