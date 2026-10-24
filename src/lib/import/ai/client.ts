/**
 * Browser side of the AI boundary. The only network calls in the import flow, made to our own
 * `/api/interpret` route, which holds the provider key; the UI calls these only when the user turned AI on.
 */
import type { InterpretationRequest, WorkbookInterpretation, WorkbookInterpreter } from '../model';
import {
	aiAvailabilitySchema,
	aiErrorSchema,
	workbookInterpretationSchema,
	type AiAvailability
} from './schema';

export const INTERPRET_ENDPOINT = '/api/interpret';

/** Thrown by the HTTP interpreter; `code` mirrors the route's error codes, e.g. `ai-unavailable`. */
export class InterpretationError extends Error {
	readonly code: string;
	constructor(code: string, message: string) {
		super(message);
		this.name = 'InterpretationError';
		this.code = code;
	}
}

export function createHttpInterpreter(fetchImpl: typeof fetch = fetch): WorkbookInterpreter {
	return {
		async interpret(
			request: InterpretationRequest,
			signal?: AbortSignal
		): Promise<WorkbookInterpretation> {
			const response = await fetchImpl(INTERPRET_ENDPOINT, {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(request),
				signal
			});
			const body: unknown = await response.json().catch(() => null);
			if (!response.ok) {
				const error = aiErrorSchema.safeParse(body);
				throw error.success
					? new InterpretationError(error.data.code, error.data.message)
					: new InterpretationError('ai-error', `AI request failed (HTTP ${response.status})`);
			}
			// Checked again here so the verifier's input is well-formed whatever sits between it and the route.
			const parsed = workbookInterpretationSchema.safeParse(body);
			if (!parsed.success)
				throw new InterpretationError(
					'ai-invalid-response',
					'The AI service sent an unexpected response'
				);
			return parsed.data;
		}
	};
}

export async function getAiAvailability(fetchImpl: typeof fetch = fetch): Promise<AiAvailability> {
	try {
		const response = await fetchImpl(INTERPRET_ENDPOINT);
		if (!response.ok)
			return { available: false, reason: `AI service check failed (HTTP ${response.status})` };
		const parsed = aiAvailabilitySchema.safeParse(await response.json());
		return parsed.success
			? parsed.data
			: { available: false, reason: 'AI service sent an unexpected response' };
	} catch {
		return { available: false, reason: 'AI service is unreachable' };
	}
}
