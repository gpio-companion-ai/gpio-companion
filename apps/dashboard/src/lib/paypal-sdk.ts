export type PaypalButtons = {
	render: (selector: string | HTMLElement) => Promise<void>;
	close: () => Promise<void>;
};

type PaypalNamespace = {
	Buttons: (options: {
		createOrder: () => string | Promise<string>;
		onApprove: (data: { orderID: string }) => void | Promise<void>;
		onError?: (error: Error) => void;
		onCancel?: () => void;
		style?: {
			layout?: "vertical" | "horizontal";
			color?: "gold" | "blue" | "silver" | "white" | "black";
			shape?: "rect" | "pill";
			label?: "paypal" | "pay" | "checkout" | "buynow";
			height?: number;
		};
	}) => PaypalButtons;
};

const SDK_ID = "paypal-sdk";

export function paypalButtonsStyle() {
	return {
		layout: "horizontal" as const,
		color: "gold" as const,
		shape: "rect" as const,
		label: "pay" as const,
		height: 45,
	};
}

export async function loadPaypalSdk(options: {
	clientId: string;
	liveMode?: boolean;
}): Promise<PaypalNamespace> {
	const scriptId = `${SDK_ID}-capture`;
	const existing = (window as unknown as { paypal?: PaypalNamespace }).paypal;
	const currentScript = document.getElementById(scriptId);
	if (existing?.Buttons && currentScript) {
		return existing;
	}

	for (const node of document.querySelectorAll(`script[id^="${SDK_ID}-"]`)) {
		node.remove();
	}
	(window as unknown as { paypal?: PaypalNamespace }).paypal = undefined;

	const params = new URLSearchParams({
		"client-id": options.clientId,
		currency: "USD",
		intent: "capture",
		locale: "en_US",
		components: "buttons",
		"disable-funding": "paylater,card",
	});

	await new Promise<void>((resolve, reject) => {
		const previous = document.getElementById(scriptId);
		if (previous) {
			previous.addEventListener("load", () => resolve(), { once: true });
			previous.addEventListener(
				"error",
				() => reject(new Error("Could not load PayPal.")),
				{ once: true },
			);
			return;
		}
		const script = document.createElement("script");
		script.id = scriptId;
		const sdkHost =
			options.liveMode === false
				? "https://www.sandbox.paypal.com/sdk/js"
				: "https://www.paypal.com/sdk/js";
		script.src = `${sdkHost}?${params.toString()}`;
		script.async = true;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("Could not load PayPal."));
		document.head.appendChild(script);
	});

	const paypal = (window as unknown as { paypal?: PaypalNamespace }).paypal;
	if (!paypal?.Buttons) {
		throw new Error("PayPal SDK is not available.");
	}
	return paypal;
}
