export type ActionOk<T> = { ok: true; data: T };
export type ActionFail = { ok: false; error: string };
export type ActionResult<T> = ActionOk<T> | ActionFail;

function errorMessage(caught: unknown): string {
	if (caught instanceof Error && caught.message.trim()) {
		return caught.message;
	}
	return "request failed";
}

export function wrapAction<Args extends unknown[], T>(
	fn: (...args: Args) => Promise<T>,
): (...args: Args) => Promise<ActionResult<T>> {
	const wrapped = async (...args: Args): Promise<ActionResult<T>> => {
		try {
			return { ok: true, data: await fn(...args) };
		} catch (caught) {
			return { ok: false, error: errorMessage(caught) };
		}
	};
	Object.defineProperty(wrapped, "length", {
		value: fn.length,
		configurable: true,
	});
	return wrapped as (...args: Args) => Promise<ActionResult<T>>;
}

export function isActionFail(result: unknown): result is ActionFail {
	return Boolean(
		result &&
			typeof result === "object" &&
			(result as ActionFail).ok === false &&
			typeof (result as ActionFail).error === "string",
	);
}

export function unwrapAction<T>(result: ActionResult<T>): T {
	if (!result.ok) {
		throw new Error(result.error);
	}
	return result.data;
}

export async function runAction<T>(
	promise: Promise<ActionResult<T>>,
	report?: (error: string) => void,
): Promise<T | null> {
	try {
		return unwrapAction(await promise);
	} catch (caught) {
		report?.(errorMessage(caught));
		return null;
	}
}
