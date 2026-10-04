import Alert from "@shpaw415/mui-lite/Alert";
import Button from "@shpaw415/mui-lite/Button";
import Paper from "@shpaw415/mui-lite/Paper";
import Radio from "@shpaw415/mui-lite/Radio";
import TextField from "@shpaw415/mui-lite/TextField";
import Typography from "@shpaw415/mui-lite/Typography";
import { useEffect, useState } from "react";
import {
	GET as paypalConfig,
	POST as quote,
	PUT as startCheckout,
} from "../../actions/api/checkout.ts";
import { POST as captureOrder } from "../../actions/api/orders.ts";
import { useCart } from "../../hooks/useCart.tsx";
import { useLocale, useT } from "../../hooks/useLocale.tsx";
import { useSession } from "../../hooks/useSession.tsx";
import { readConsent, writeConsent } from "../../lib/consent.ts";
import { formatCents } from "../../lib/format.ts";

const IDEMPOTENCY_KEY = "gpio-companion-checkout-key";

type PayPalButtons = {
	Buttons: (options: {
		createOrder: () => Promise<string>;
		onApprove: () => Promise<void>;
	}) => { render: (selector: string) => Promise<void> };
};

type ShippingOption = {
	id: string;
	courierName: string;
	totalCents: number;
	minDays: number | null;
	maxDays: number | null;
	description: string | null;
};

function checkoutKey(): string {
	const existing = window.sessionStorage.getItem(IDEMPOTENCY_KEY);
	if (existing) return existing;
	const next = crypto.randomUUID();
	window.sessionStorage.setItem(IDEMPOTENCY_KEY, next);
	return next;
}

async function loadPayPal(clientId: string) {
	const win = window as Window & { paypal?: PayPalButtons };
	if (win.paypal) return win.paypal;
	await new Promise<void>((resolve, reject) => {
		const script = document.createElement("script");
		script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
		script.onload = () => resolve();
		script.onerror = () => reject(new Error("PayPal failed to load"));
		document.body.appendChild(script);
	});
	return (window as Window & { paypal?: PayPalButtons }).paypal;
}

export default function CheckoutPage() {
	const t = useT();
	const { locale } = useLocale();
	const cart = useCart();
	const { session, ready } = useSession();
	const [name, setName] = useState("");
	const [email, setEmail] = useState("");
	const [country, setCountry] = useState("");
	const [region, setRegion] = useState("");
	const [line1, setLine1] = useState("");
	const [line2, setLine2] = useState("");
	const [city, setCity] = useState("");
	const [postal, setPostal] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [subtotalCents, setSubtotalCents] = useState<number | null>(null);
	const [shippingOptions, setShippingOptions] = useState<ShippingOption[]>([]);
	const [selectedOptionId, setSelectedOptionId] = useState<string | null>(null);
	const [quoting, setQuoting] = useState(false);
	const [selectedShipping, setSelectedShipping] = useState<{
		shippingCents: number;
		courierName: string | null;
	} | null>(null);
	const [paypalOrderId, setPaypalOrderId] = useState<string | null>(null);
	const [orderId, setOrderId] = useState<string | null>(null);
	const [clientId, setClientId] = useState<string | null>(null);
	const [paypalEnabled, setPaypalEnabled] = useState(false);
	const [consent, setConsent] = useState(false);
	const [done, setDone] = useState(false);

	useEffect(() => {
		setConsent(readConsent()?.thirdParty === true);
		paypalConfig()
			.then((config) => {
				setPaypalEnabled(config.enabled);
				setClientId(config.clientId);
			})
			.catch(() => setPaypalEnabled(false));
	}, []);

	useEffect(() => {
		if (session?.email) setEmail(session.email);
		if (session?.name) setName(session.name);
	}, [session?.email, session?.name]);

	useEffect(() => {
		if (!paypalOrderId || !clientId || !consent || !orderId) return;
		let cancelled = false;
		loadPayPal(clientId)
			.then((paypal) => {
				if (cancelled || !paypal) return;
				const host = document.getElementById("paypal-buttons");
				if (!host || host.childElementCount > 0) return;
				return paypal
					.Buttons({
						createOrder: async () => paypalOrderId,
						onApprove: async () => {
							await captureOrder(orderId);
							cart.clear();
							window.sessionStorage.removeItem(IDEMPOTENCY_KEY);
							setDone(true);
						},
					})
					.render("#paypal-buttons");
			})
			.catch((err: unknown) =>
				setError(err instanceof Error ? err.message : String(err)),
			);
		return () => {
			cancelled = true;
		};
	}, [paypalOrderId, clientId, consent, orderId, cart]);

	const selectedOption =
		shippingOptions.find((option) => option.id === selectedOptionId) ?? null;
	const shippingCents =
		selectedShipping?.shippingCents ?? selectedOption?.totalCents ?? null;
	const totalCents =
		subtotalCents !== null && shippingCents !== null
			? subtotalCents + shippingCents
			: null;

	function destinationFilled(): boolean {
		return Boolean(
			line1.trim() && city.trim() && postal.trim() && country.trim(),
		);
	}

	function destination() {
		return {
			line1,
			line2: line2 || null,
			city,
			region: region || null,
			postalCode: postal,
			country,
		};
	}

	async function calculate() {
		setError(null);
		if (!destinationFilled()) {
			setShippingOptions([]);
			setSelectedOptionId(null);
			setError(t("checkout.addressRequired"));
			return;
		}
		setQuoting(true);
		try {
			const priced = await quote(
				cart.items.map((item) => ({
					productId: item.id,
					quantity: item.quantity,
				})),
				destination(),
			);
			setSubtotalCents(priced.subtotalCents);
			setShippingOptions(priced.shippingOptions);
			setSelectedOptionId(priced.shippingOptions[0]?.id ?? null);
			setSelectedShipping(null);
			if (priced.shippingOptions.length === 0) {
				setError(t("checkout.noShippingOptions"));
			}
		} catch (err) {
			setShippingOptions([]);
			setSelectedOptionId(null);
			setError(err instanceof Error ? err.message : t("cart.stockChanged"));
		} finally {
			setQuoting(false);
		}
	}

	async function prepare() {
		if (!selectedOptionId) {
			setError(t("checkout.selectShippingFirst"));
			return;
		}
		setError(null);
		try {
			const started = await startCheckout({
				items: cart.items.map((item) => ({
					productId: item.id,
					quantity: item.quantity,
				})),
				address: {
					name,
					email,
					line1,
					line2,
					city,
					region,
					postalCode: postal,
					country,
				},
				shippingOptionId: selectedOptionId,
				idempotencyKey: checkoutKey(),
			});
			setOrderId(started.orderId);
			setPaypalOrderId(started.paypalOrderId);
			setSelectedShipping({
				shippingCents: started.shippingCents,
				courierName: started.shippingCourierName,
			});
		} catch (err) {
			setSelectedShipping(null);
			setError(err instanceof Error ? err.message : t("cart.stockChanged"));
		}
	}

	if (!ready) return null;
	if (!session?.id) {
		return (
			<Alert severity="info" title={t("auth.signIn")}>
				<p>{t("checkout.signIn")}</p>
				<Button href="/login" variant="contained">
					{t("nav.signIn")}
				</Button>
			</Alert>
		);
	}
	if (done && orderId) {
		return (
			<Alert severity="success" title={t("checkout.success")}>
				<Button href={`/orders/${orderId}`} variant="contained">
					{t("orders.title")}
				</Button>
			</Alert>
		);
	}

	return (
		<div className="market-checkout-grid">
			<Paper variant="outlined" className="market-checkout-form">
				<Typography variant="h5" component="h1">
					{t("checkout.shippingTitle")}
				</Typography>
				{error ? <Alert severity="error">{error}</Alert> : null}
				<TextField
					label={t("checkout.fullName")}
					value={name}
					onChange={(event) => setName(event.target.value)}
				/>
				<TextField label={t("checkout.email")} value={email} disabled />
				<div className="market-form-row">
					<TextField
						label={t("checkout.countryCode")}
						value={country}
						placeholder="US"
						onChange={(event) => setCountry(event.target.value)}
					/>
					<TextField
						label={t("checkout.region")}
						value={region}
						onChange={(event) => setRegion(event.target.value)}
					/>
				</div>
				<TextField
					label={t("checkout.address")}
					value={line1}
					onChange={(event) => setLine1(event.target.value)}
				/>
				<TextField
					label={t("checkout.line2")}
					value={line2}
					onChange={(event) => setLine2(event.target.value)}
				/>
				<div className="market-form-row">
					<TextField
						label={t("checkout.cityPostal")}
						value={city}
						onChange={(event) => setCity(event.target.value)}
					/>
					<TextField
						label={t("checkout.postal")}
						value={postal}
						onChange={(event) => setPostal(event.target.value)}
					/>
				</div>
				<div className="bar">
					<Button
						variant="outlined"
						onClick={() => void calculate()}
						disabled={cart.items.length === 0 || quoting}
					>
						{quoting ? t("checkout.quoting") : t("checkout.quote")}
					</Button>
					<Button
						variant="contained"
						onClick={() => void prepare()}
						disabled={
							!paypalEnabled || cart.items.length === 0 || !selectedOptionId
						}
					>
						{t("checkout.pay")}
					</Button>
				</div>
				{shippingOptions.length > 0 ? (
					<fieldset className="market-shipping-options">
						<legend>
							<Typography variant="subtitle1">
								{t("checkout.shippingOptions")}
							</Typography>
						</legend>
						{shippingOptions.map((option) => (
							<label
								key={option.id}
								className="market-shipping-option"
								htmlFor={`shipping-option-${option.id}`}
							>
								<Radio
									id={`shipping-option-${option.id}`}
									name="shipping-option"
									checked={selectedOptionId === option.id}
									onChange={() => {
										setSelectedOptionId(option.id);
										setSelectedShipping(null);
									}}
								/>
								<span className="market-shipping-option-body">
									<span className="market-shipping-option-name">
										{option.courierName}
									</span>
									{option.minDays !== null || option.maxDays !== null ? (
										<span className="market-shipping-option-days">
											{t("checkout.shippingDays", {
												min: option.minDays ?? "—",
												max: option.maxDays ?? "—",
											})}
										</span>
									) : null}
									{option.description ? (
										<span className="market-shipping-option-description">
											{option.description}
										</span>
									) : null}
								</span>
								<span className="market-shipping-option-price">
									{formatCents(option.totalCents, "USD", locale)}
								</span>
							</label>
						))}
					</fieldset>
				) : null}
				{!paypalEnabled ? (
					<Alert severity="warning">{t("checkout.paypalMissing")}</Alert>
				) : null}
				{!consent ? (
					<Alert severity="info" title={t("cookies.title")}>
						<p>{t("checkout.paypalConsent")}</p>
						<Button
							variant="outlined"
							onClick={() => {
								writeConsent(true);
								setConsent(true);
							}}
						>
							{t("checkout.allowPaypal")}
						</Button>
					</Alert>
				) : null}
				<div id="paypal-buttons" />
			</Paper>
			<Paper variant="outlined" className="market-totals">
				<Typography variant="h6">{t("cart.summary")}</Typography>
				<div className="row">
					<span>{t("cart.subtotal")}</span>
					<span>
						{subtotalCents !== null
							? formatCents(subtotalCents, "USD", locale)
							: t("catalog.tbd")}
					</span>
				</div>
				<div className="row">
					<span>{t("cart.shipping")}</span>
					<span>
						{shippingCents !== null
							? formatCents(shippingCents, "USD", locale)
							: t("catalog.tbd")}
					</span>
				</div>
				<div className="row grand">
					<span>{t("cart.total")}</span>
					<span>
						{totalCents !== null
							? formatCents(totalCents, "USD", locale)
							: t("catalog.tbd")}
					</span>
				</div>
				{selectedShipping?.courierName ? (
					<Typography variant="body2" color="textSecondary">
						{selectedShipping.courierName}
					</Typography>
				) : null}
				<Typography variant="body2" color="textSecondary">
					{t("checkout.reservation")}
				</Typography>
			</Paper>
		</div>
	);
}
