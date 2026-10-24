/**
 * Wire format of the AI explanation boundary, shared by the browser and the `/api/explain` route.
 *
 * The request carries facts and the plain (rules) wording of each decision, never sheet samples or other
 * rows. The reply is wording only: a headline and a body per item, which the browser checks against that
 * item's facts before showing it (`explain-verify.ts`).
 */
import { z } from 'zod';
import type { Fact } from '../explain';

export const EXPLAIN_LIMITS = {
	maxItems: 60,
	maxFactsPerItem: 24,
	maxLabelChars: 80,
	/** Long descriptions are cut, with "…", like cell text in the interpretation sample. */
	maxValueChars: 200,
	maxPlainHeadlineChars: 160,
	maxPlainBodyChars: 600,
	/** Hard ceilings on the reply; the verifier also keeps each text no longer than its plain version. */
	maxHeadlineChars: 80,
	maxBodyChars: 400
} as const;

const factSchema = z.object({
	label: z.string().min(1).max(EXPLAIN_LIMITS.maxLabelChars),
	value: z.string().max(EXPLAIN_LIMITS.maxValueChars),
	cell: z
		.string()
		.regex(/^[A-Z]{1,3}[1-9]\d{0,6}$/)
		.optional()
});

const itemSchema = z.object({
	/** Short ids ("d1"), so decision ids with sheet names and record ids never leave the browser. */
	id: z.string().regex(/^d\d{1,3}$/),
	kind: z.string().max(40),
	facts: z.array(factSchema).max(EXPLAIN_LIMITS.maxFactsPerItem),
	plain: z.object({
		headline: z.string().max(EXPLAIN_LIMITS.maxPlainHeadlineChars),
		body: z.string().max(EXPLAIN_LIMITS.maxPlainBodyChars)
	})
});

export const explanationRequestSchema = z.object({
	items: z.array(itemSchema).min(1).max(EXPLAIN_LIMITS.maxItems)
});

export type ExplanationRequest = z.infer<typeof explanationRequestSchema>;
export type ExplanationRequestItem = ExplanationRequest['items'][number];

/** No length constraints here: Claude's structured outputs reject them, and the verifier enforces lengths. */
export const explanationResponseSchema = z.object({
	items: z.array(
		z.object({
			id: z.string().describe('The id of the item this explains, exactly as given'),
			headline: z.string().describe('What is wrong, in at most 60 characters'),
			body: z.string().describe('One or two short sentences about the problem; never what to do')
		})
	)
});

export type ExplanationResponse = z.infer<typeof explanationResponseSchema>;

export function explanationJsonSchema(): Record<string, unknown> {
	const schema: Record<string, unknown> = z.toJSONSchema(explanationResponseSchema);
	delete schema.$schema;
	return schema;
}

/** Small seam so the provider can be mocked in tests or replaced, like `WorkbookInterpreter`. */
export interface Explainer {
	explain(request: ExplanationRequest, signal?: AbortSignal): Promise<ExplanationResponse>;
}

const clip = (text: string, max: number) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** One request item within the limits: long values cut, at most `maxFactsPerItem` facts. */
export function boundedItem(id: string, kind: string, facts: readonly Fact[], plain: { headline: string; body: string }): ExplanationRequestItem {
	return {
		id,
		kind,
		facts: facts.slice(0, EXPLAIN_LIMITS.maxFactsPerItem).map((fact) => ({
			label: clip(fact.label, EXPLAIN_LIMITS.maxLabelChars),
			value: clip(fact.value, EXPLAIN_LIMITS.maxValueChars),
			...(fact.cell && { cell: fact.cell })
		})),
		plain: {
			headline: clip(plain.headline, EXPLAIN_LIMITS.maxPlainHeadlineChars),
			body: clip(plain.body, EXPLAIN_LIMITS.maxPlainBodyChars)
		}
	};
}
