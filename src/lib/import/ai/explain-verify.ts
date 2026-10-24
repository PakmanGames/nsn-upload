/**
 * Checks AI wording item by item against the facts it was given. Anything that fails keeps the plain
 * (rules) wording, so a bad answer costs clarity, never correctness.
 *
 * The model may only rephrase: every cell reference and every number of 4 or more digits it writes must
 * come from that item's facts, it must follow the same copy rules as the rules wording, and it must not
 * slip in a suggestion, because the options and the suggestion are the pipeline's and shown on their own.
 */
import { copyProblems } from '../explain';
import { EXPLAIN_LIMITS, type ExplanationRequestItem, type ExplanationResponse } from './explain-schema';

/** A request item plus what the verifier needs but the model is not sent: the decision's option labels. */
export type VerifiableItem = ExplanationRequestItem & { options: readonly string[] };

export type ExplanationVerification = {
	/** Wording that passed, by item id. */
	explained: Map<string, { headline: string; body: string }>;
	/** Items that keep the plain wording, with why. Includes items the reply left out. */
	rejected: Array<{ id: string; reason: string }>;
};

/** Looks like an A1 reference: 1-3 capital letters, then a row number. */
const CELL_REF = /\b[A-Z]{1,3}[1-9]\d{0,6}\b/g;
/** A run of digits, hyphens allowed between them, as NSNs are written. */
const NUMBER = /\d(?:[\d-]*\d)?/g;
const SUGGESTION = /\b(?:suggest|recommend|advis)|\byou should\b|\bbest to\b/i;

const numbersIn = (text: string) => [...text.matchAll(NUMBER)].map(([run]) => run.replace(/-/g, ''));

/** The cell references and long numbers an item's facts allow its text to mention. */
function allowed(item: ExplanationRequestItem): { cells: Set<string>; numbers: Set<string> } {
	const cells = new Set<string>();
	const numbers = new Set<string>();
	for (const { label, value, cell } of item.facts) {
		if (cell) cells.add(cell);
		// Code-like values such as part number SE5826 have the shape of a cell reference too.
		for (const text of [label, value]) for (const [ref] of text.matchAll(CELL_REF)) cells.add(ref);
		for (const digits of numbersIn(`${label} ${value} ${cell ?? ''}`)) {
			numbers.add(digits);
			// An NSN's FSC and NIIN are part of it, so the text may name them on their own.
			if (digits.length === 13) numbers.add(digits.slice(0, 4)).add(digits.slice(4));
		}
	}
	return { cells, numbers };
}

/** Why the wording cannot be shown, or null when it can. */
function problem(item: VerifiableItem, headline: string, body: string): string | null {
	if (!headline || !body) return 'empty text';
	if (headline.length > EXPLAIN_LIMITS.maxHeadlineChars || body.length > EXPLAIN_LIMITS.maxBodyChars) return 'too long';
	// No longer than the plain wording, so the card does not grow when the AI text replaces it.
	if (headline.length > item.plain.headline.length || body.length > item.plain.body.length) return 'longer than the plain wording';

	const text = `${headline}\n${body}`;
	const copy = copyProblems(text, item.facts);
	if (copy.length) return copy[0];
	if (SUGGESTION.test(text)) return 'suggests what to do';
	const lower = text.toLowerCase();
	const option = item.options.find((label) => lower.includes(label.toLowerCase()));
	if (option) return `names the option "${option}"`;

	const { cells, numbers } = allowed(item);
	const cell = [...text.matchAll(CELL_REF)].map(([ref]) => ref).find((ref) => !cells.has(ref));
	if (cell) return `cell ${cell} is not in the facts`;
	const number = numbersIn(text).find((digits) => digits.length >= 4 && !numbers.has(digits));
	if (number) return `number ${number} is not in the facts`;
	return null;
}

export function verifyExplanations(items: readonly VerifiableItem[], response: ExplanationResponse): ExplanationVerification {
	const asked = new Map(items.map((item) => [item.id, item]));
	const explained = new Map<string, { headline: string; body: string }>();
	const rejected: ExplanationVerification['rejected'] = [];
	const answered = new Set<string>();
	for (const { id, headline, body } of response.items) {
		const item = asked.get(id);
		if (!item) {
			rejected.push({ id, reason: 'not asked for' });
			continue;
		}
		if (answered.has(id)) {
			// Two answers for one item: neither can be trusted to be the intended one.
			if (explained.delete(id)) rejected.push({ id, reason: 'answered twice' });
			continue;
		}
		answered.add(id);
		const reason = problem(item, headline.trim(), body.trim());
		if (reason) rejected.push({ id, reason });
		else explained.set(id, { headline: headline.trim(), body: body.trim() });
	}
	for (const id of asked.keys()) if (!answered.has(id)) rejected.push({ id, reason: 'no answer' });
	return { explained, rejected };
}
