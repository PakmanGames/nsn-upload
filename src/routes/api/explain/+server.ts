/**
 * AI explanation endpoint. The browser posts the facts and plain wording of up to 60 decisions; this route
 * validates them again, asks the provider for clearer wording, and validates the shape of the answer.
 * The browser then checks every item against its facts. The provider key never reaches the client.
 */
import { json } from '@sveltejs/kit';
import { env } from '$env/dynamic/private';
import { MockExplainer } from '$lib/import/ai/explain-mock';
import { DEFAULT_EXPLAIN_MODEL, createOpenRouterExplainer } from '$lib/import/ai/explain-openrouter';
import { explanationRequestSchema, type Explainer } from '$lib/import/ai/explain-schema';
import { ProviderError } from '$lib/import/ai/openrouter';
import type { RequestHandler } from './$types';

const UNAVAILABLE = 'AI assistance is not configured on this server (OPENROUTER_API_KEY is not set)';

/** The same provider selection as `/api/interpret`. Env is read per request so a changed key needs no rebuild. */
function configuredExplainer(fetchImpl: typeof fetch): Explainer | null {
	if (env.AI_PROVIDER === 'mock') return new MockExplainer();
	if (!env.OPENROUTER_API_KEY) return null;
	return createOpenRouterExplainer({
		apiKey: env.OPENROUTER_API_KEY,
		model: env.OPENROUTER_EXPLAIN_MODEL || DEFAULT_EXPLAIN_MODEL,
		fetch: fetchImpl
	});
}

export const POST: RequestHandler = async ({ request, fetch }) => {
	const explainer = configuredExplainer(fetch);
	if (!explainer) return json({ code: 'ai-unavailable', message: UNAVAILABLE }, { status: 503 });

	const parsed = explanationRequestSchema.safeParse(await request.json().catch(() => undefined));
	if (!parsed.success) {
		const issues = parsed.error.issues
			.slice(0, 5)
			.map((issue) => `${issue.path.join('.') || 'body'}: ${issue.message}`)
			.join('; ');
		return json({ code: 'invalid-request', message: `Invalid explanation request (${issues})` }, { status: 400 });
	}

	try {
		return json(await explainer.explain(parsed.data, request.signal));
	} catch (error) {
		if (!(error instanceof ProviderError)) throw error;
		console.error(`[api/explain] ${error.code}: ${error.message}`);
		return json({ code: error.code, message: error.message }, { status: error.status });
	}
};
