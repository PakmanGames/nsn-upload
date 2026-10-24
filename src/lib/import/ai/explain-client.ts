/**
 * Browser side of AI explanations: one POST to our own `/api/explain` route, which holds the provider key.
 * The session calls it only while AI assistance is on.
 */
import { aiErrorSchema } from './schema';
import {
	explanationRequestSchema,
	explanationResponseSchema,
	type Explainer,
	type ExplanationRequest,
	type ExplanationResponse
} from './explain-schema';

export const EXPLAIN_ENDPOINT = '/api/explain';

/** Thrown by the HTTP explainer; `code` mirrors the route's error codes, e.g. `ai-unavailable`. */
export class ExplanationError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'ExplanationError';
		this.code = code;
	}
}

export function createHttpExplainer(fetchImpl: typeof fetch = fetch): Explainer {
	return {
		async explain(request: ExplanationRequest, signal?: AbortSignal): Promise<ExplanationResponse> {
			// Checked before sending, so a bug that would exceed the bounds fails here instead of at the route.
			explanationRequestSchema.parse(request);
			const response = await fetchImpl(EXPLAIN_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal
			});
			const body: unknown = await response.json().catch(() => null);
			if (!response.ok) {
				const error = aiErrorSchema.safeParse(body);
				throw error.success
					? new ExplanationError(error.data.code, error.data.message)
					: new ExplanationError('ai-error', `AI request failed (HTTP ${response.status})`);
			}
			const parsed = explanationResponseSchema.safeParse(body);
			if (!parsed.success) throw new ExplanationError('ai-invalid-response', 'The AI service sent an unexpected response');
			return parsed.data;
		}
	};
}

/**
 * 53-bit string hash (cyrb53): short, stable cache keys for an explanation's facts and wording.
 * Not cryptographic; a collision would only show wording checked against a near-identical set of facts.
 */
export function hashText(text: string): string {
	let h1 = 0xdeadbeef;
	let h2 = 0x41c6ce57;
	for (let i = 0; i < text.length; i++) {
		const code = text.charCodeAt(i);
		h1 = Math.imul(h1 ^ code, 2654435761);
		h2 = Math.imul(h2 ^ code, 1597334677);
	}
	h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
	h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
	return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}
