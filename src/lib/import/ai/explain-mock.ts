/**
 * Mock explainer for tests, E2E runs, and demos (`AI_PROVIDER=mock`): no network, deterministic.
 * Also holds the wrong or manipulated answers the verifier must reject.
 */
import type { Explainer, ExplanationRequest, ExplanationRequestItem, ExplanationResponse } from './explain-schema';

type Respond = ExplanationResponse | ((request: ExplanationRequest) => ExplanationResponse);

export class MockExplainer implements Explainer {
	private readonly respond: Respond;

	/** Canned result, or a function of the request. Defaults to `mockExplanations`. */
	constructor(respond: Respond = mockExplanations) {
		this.respond = respond;
	}

	async explain(request: ExplanationRequest, signal?: AbortSignal): Promise<ExplanationResponse> {
		signal?.throwIfAborted();
		return typeof this.respond === 'function' ? this.respond(request) : this.respond;
	}
}

/**
 * A recognizable rewording built from the item alone: the plain headline, and a body that restates the
 * facts with their cells ("Based on NSN 5305-01-658-2565 (B2) and NIIN 016698021 (D2)."), as many as fit
 * within the plain body's length. It cites only facts, so it always passes verification.
 */
export function mockExplanations(request: ExplanationRequest): ExplanationResponse {
	return { items: request.items.map((item) => ({ id: item.id, headline: item.plain.headline, body: mockBody(item) })) };
}

function mockBody(item: ExplanationRequestItem): string {
	const parts = item.facts
		.filter((fact) => fact.value.trim() && !fact.value.includes('\n'))
		.map((fact) => {
			// A value that already says what it is ("row 10") needs no label in front of it.
			const named = fact.value.toLowerCase().includes(fact.label.toLowerCase()) ? fact.value : `${fact.label} ${fact.value}`;
			return fact.cell ? `${named} (${fact.cell})` : named;
		});
	for (let n = parts.length; n > 0; n--) {
		const body = `Based on ${joinAnd(parts.slice(0, n))}.`;
		if (body.length <= item.plain.body.length) return body;
	}
	return item.plain.body;
}

const joinAnd = (items: string[]) => (items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

/**
 * Wrong or manipulated rewordings of a correct item, one per verifier rule. `item` needs an NSN fact with
 * a cell, and `option` is one of its decision's option labels.
 */
export function adversarialExplanations(
	item: ExplanationRequestItem,
	option: string
): Record<
	| 'inventedNsn'
	| 'foreignCell'
	| 'suggestion'
	| 'optionLabel'
	| 'qualifiedRef'
	| 'bareNsn'
	| 'jargon'
	| 'longerThanPlain'
	| 'unknownId',
	ExplanationResponse['items'][number]
> {
	const { id, plain } = item;
	const nsn = item.facts.find((fact) => /^\d{4}-\d{2}-\d{3}-\d{4}$/.test(fact.value))!;
	const short = (body: string) => ({ id, headline: plain.headline.slice(0, 20), body });
	return {
		inventedNsn: short('The NSN reads 9999-01-234-5678.'),
		foreignCell: short(`See ${nsn.cell} and Z999.`),
		suggestion: short('We suggest leaving it out.'),
		optionLabel: short(`${option}.`),
		qualifiedRef: short(`Sheet1!${nsn.cell} holds it.`),
		bareNsn: short(`It is ${nsn.value.replace(/-/g, '')}.`),
		jargon: short('The candidate record was split.'),
		longerThanPlain: { id, headline: plain.headline, body: `${plain.body} ${plain.body}` },
		unknownId: { id: 'd999', headline: plain.headline, body: plain.body }
	};
}
