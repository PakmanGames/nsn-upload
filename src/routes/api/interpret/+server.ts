/**
 * AI interpretation endpoint. The browser posts a bounded workbook sample; this route validates it
 * again, asks the provider for structure, and validates the answer before returning it.
 * The provider key is read from private env here and never reaches the client.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import type { WorkbookInterpreter } from '$lib/import/model';
import { MockInterpreter } from '$lib/import/ai/mock';
import {
	DEFAULT_OPENROUTER_MODEL,
	ProviderError,
	createOpenRouterInterpreter
} from '$lib/import/ai/openrouter';
import { interpretationRequestSchema } from '$lib/import/ai/schema';
import type { RequestHandler } from './$types';

const UNAVAILABLE =
	'AI assistance is not configured on this server (OPENROUTER_API_KEY is not set)';

/** Null when AI is not configured. Env is read per request so a changed key needs no rebuild. */
function configuredInterpreter(fetchImpl: typeof fetch): WorkbookInterpreter | null {
	if (env.AI_PROVIDER === 'mock') return new MockInterpreter();
	if (!env.OPENROUTER_API_KEY) return null;
	return createOpenRouterInterpreter({
		apiKey: env.OPENROUTER_API_KEY,
		model: env.OPENROUTER_MODEL || DEFAULT_OPENROUTER_MODEL,
		fetch: fetchImpl
	});
}

export const GET: RequestHandler = ({ fetch }) =>
	json(
		configuredInterpreter(fetch) ? { available: true } : { available: false, reason: UNAVAILABLE }
	);

export const POST: RequestHandler = async ({ request, fetch }) => {
	const interpreter = configuredInterpreter(fetch);
	if (!interpreter) return json({ code: 'ai-unavailable', message: UNAVAILABLE }, { status: 503 });

	const parsed = interpretationRequestSchema.safeParse(await request.json().catch(() => undefined));
	if (!parsed.success) {
		const issues = parsed.error.issues
			.slice(0, 5)
			.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
			.join('; ');
		return json(
			{ code: 'invalid-request', message: `Invalid AI request (${issues})` },
			{ status: 400 }
		);
	}

	try {
		return json(await interpreter.interpret(parsed.data, request.signal));
	} catch (error) {
		if (!(error instanceof ProviderError)) throw error;
		console.error(`[api/interpret] ${error.code}: ${error.message}`);
		return json({ code: error.code, message: error.message }, { status: error.status });
	}
};
