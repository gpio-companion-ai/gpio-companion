export type UiPreviewRequest = {
	repo: string;
	path: string;
};

let pending: UiPreviewRequest | null = null;

export function setPendingUiPreview(next: UiPreviewRequest | null): void {
	pending = next;
}

export function takePendingUiPreview(): UiPreviewRequest | null {
	const current = pending;
	pending = null;
	return current;
}
