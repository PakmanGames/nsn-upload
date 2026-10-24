/**
 * Per-cell checks used to score a column against a field.
 *
 * Identifier fields are scored with the same rules that later validate each value, so a column's pass rate
 * predicts how many of its records will import.
 */
import type { Cell, Field } from '../model';
import { isPlausiblePart } from '../identifiers';
import { normalizeField } from '../normalize';

/**
 * pass: valid as is. repaired: valid only after a repair that loses certainty (a number cell turned into
 * part text, leading zeros restored). fail: not a value of this field. skip: no evidence either way.
 */
export type Verdict = 'pass' | 'repaired' | 'fail' | 'skip';

const URL = /^(https?:\/\/|www\.)/i;

/**
 * Part numbers have no strict format, so this is the shared plausibility check applied to every
 * newline-separated segment (a two-part cell such as `12669555\nRVX08212` still counts as part numbers).
 */
function checkPart(cell: Cell): Verdict {
	if (cell.kind === 'date' || cell.kind === 'boolean') return 'fail';
	if (cell.kind === 'number') return 'repaired';
	const segments = cell.text.split('\n').map((s) => s.trim()).filter(Boolean);
	if (segments.length === 0 || cell.text.trim() === '-') return 'skip';
	return segments.every(isPlausiblePart) ? 'pass' : 'fail';
}

/** A description has letters and does not look like a code: a single token with digits, a URL, or an NSN/NIIN. */
function checkDescription(cell: Cell): Verdict {
	if (cell.kind !== 'text') return 'fail';
	const text = cell.text.trim();
	if (text === '-') return 'skip';
	if (!/\p{L}/u.test(text) || URL.test(text)) return 'fail';
	if (!/\s/.test(text) && /\d/.test(text)) return 'fail';
	return 'pass';
}

export function checkValue(field: Field, cell: Cell, sheet: string): Verdict {
	if (cell.kind === 'empty' || cell.kind === 'error') return 'skip';
	if (field === 'part') return checkPart(cell);
	if (field === 'description') return checkDescription(cell);
	// Every column is checked for NSN and NIIN, so skip building an invalid-value message for text that
	// cannot pass: a digit-based identifier needs at least one digit.
	if (field !== 'cage' && !/\d/.test(cell.text)) return 'fail';
	const result = normalizeField(field, cell, sheet);
	if (result.kind === 'empty') return 'skip';
	if (result.kind === 'invalid') return 'fail';
	return result.warnings.length > 0 ? 'repaired' : 'pass';
}
