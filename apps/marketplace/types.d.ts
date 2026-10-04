interface Env {
	PUBLIC_PAYPAL_CLIENT_ID?: string;
	PAYPAL_CLIENT_SECRET?: string;
	PAYPAL_ENV?: string;
	EASYSHIP_API_TOKEN?: string;
	EASYSHIP_ORIGIN_LINE1?: string;
	EASYSHIP_ORIGIN_LINE2?: string;
	EASYSHIP_ORIGIN_CITY?: string;
	EASYSHIP_ORIGIN_REGION?: string;
	EASYSHIP_ORIGIN_POSTAL_CODE?: string;
	EASYSHIP_ORIGIN_COUNTRY?: string;
	EASYSHIP_ORIGIN_CONTACT_NAME?: string;
	EASYSHIP_ORIGIN_CONTACT_EMAIL?: string;
	EASYSHIP_ORIGIN_CONTACT_PHONE?: string;
	EASYSHIP_ITEM_CATEGORY?: string;
	MARKETPLACE_ADMIN_TOKEN?: string;
	AUTH_SECRET?: string;
	PUBLIC_AUTH_ISSUER?: string;
	PUBLIC_AUTH_CLIENT_ID?: string;
	PUBLIC_AUTH_REDIRECT_URI?: string;
}

declare module "@cf-process-env.json" {
	const env: Record<string, string>;
	export default env;
}
