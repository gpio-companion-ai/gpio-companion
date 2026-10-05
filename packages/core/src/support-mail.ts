export const SUPPORT_TO = "support@gpio-companion.com";
export const SUPPORT_FROM = "noreply@gpio-companion.com";

type SendResult = {
	success?: boolean;
	result?: {
		delivered?: string[];
		permanent_bounces?: string[];
		queued?: string[];
	} | null;
};

export type SupportMail = {
	to: string;
	from: { address: string; name?: string };
	replyTo?: string;
	subject: string;
	text: string;
	html: string;
};

function acceptedSend(result: SendResult, to: string): boolean {
	if (result.success !== true || !result.result) {
		return false;
	}
	const bounced = result.result.permanent_bounces ?? [];
	if (bounced.includes(to)) {
		return false;
	}
	const delivered = result.result.delivered ?? [];
	const queued = result.result.queued ?? [];
	return delivered.includes(to) || queued.includes(to);
}

export async function deliverSupportEmail(
	accountId: string,
	token: string,
	message: SupportMail,
	fetchImpl: typeof fetch = fetch,
): Promise<void> {
	const account = accountId.trim();
	const key = token.trim();
	if (!account || !key) {
		throw new Error("support email is not configured");
	}
	const payload: Record<string, unknown> = {
		to: message.to,
		from: message.from,
		subject: message.subject,
		text: message.text,
		html: message.html,
	};
	if (message.replyTo) {
		payload.reply_to = message.replyTo;
	}
	const response = await fetchImpl(
		`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(account)}/email/sending/send`,
		{
			method: "POST",
			headers: {
				Authorization: `Bearer ${key}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(payload),
		},
	);
	if (!response.ok) {
		await response.text().catch(() => "");
		throw new Error("support email is not configured");
	}
	let parsed: SendResult;
	try {
		parsed = (await response.json()) as SendResult;
	} catch {
		throw new Error("support email is not configured");
	}
	if (!acceptedSend(parsed, message.to)) {
		throw new Error("support email is not configured");
	}
}
