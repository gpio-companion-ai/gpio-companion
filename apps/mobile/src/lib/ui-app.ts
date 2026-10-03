export type UiAppRequest = {
	appId: string;
	title: string;
};

let pending: UiAppRequest | null = null;

export function setPendingUiApp(next: UiAppRequest | null): void {
	pending = next;
}

export function takePendingUiApp(): UiAppRequest | null {
	const current = pending;
	pending = null;
	return current;
}
