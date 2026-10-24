/**
 * Test double for `normalizeField`, following the rules in docs/tasks/T2-normalize.md closely enough
 * for record building: tests load it with `vi.mock('../normalize', () => import('./fake-normalize'))`
 * so they exercise records/ logic without depending on T2's exact messages.
 */
import type { Cell, Field, Issue, NormalizeResult, NormalizedValue, Transform } from '../model';
import { qualifiedRef } from '../refs';

const DIGITS: Partial<Record<Field, number>> = { nsn: 13, niin: 9, fsc: 4 };

export function normalizeField(field: Field, cell: Cell, sheet: string): NormalizeResult {
	const at = qualifiedRef(sheet, cell.ref);
	const invalid = (message: string): NormalizeResult => ({
		kind: 'invalid',
		issue: { code: 'invalid-identifier', severity: 'error', field, message, cells: [at] }
	});
	const warn = (message: string): Issue => ({ code: 'suspicious-value', severity: 'warning', field, message, cells: [at] });

	if (cell.kind === 'empty') return { kind: 'empty' };
	if (cell.kind === 'error') return invalid(`Excel error value ${cell.raw} in ${at}`);
	const text = cell.text.trim();
	if (text === '' || text === '-') return { kind: 'empty' };
	const base: Transform[] = text === cell.text ? [] : ['trim'];

	if (field === 'description') return { kind: 'ok', values: [{ value: text, transforms: base }], warnings: [] };
	if (field === 'cage') {
		const value = text.toUpperCase();
		if (!/^[A-Z0-9]{5}$/.test(value)) return invalid(`CAGE "${text}" in ${at} is not 5 letters or digits`);
		return { kind: 'ok', values: [{ value, transforms: [...base, 'uppercase'] }], warnings: [] };
	}
	if (field === 'part') {
		if (cell.kind === 'date') return invalid(`Part number in ${at} was turned into a date by Excel`);
		if (cell.kind === 'number')
			return {
				kind: 'ok',
				values: [{ value: text, transforms: ['numeric-to-text'] }],
				warnings: [warn(`Part number in ${at} is stored as a number`)]
			};
		const segments = text.split('\n').map((s) => s.trim()).filter(Boolean);
		if (segments.length > 1)
			return { kind: 'ok', values: segments.map((value) => ({ value, transforms: ['split-multi-value'] })), warnings: [] };
		return { kind: 'ok', values: [{ value: text, transforms: base }], warnings: [] };
	}

	// nsn, niin, fsc: strip separators, then an exact digit count per segment.
	const segments = text.split('\n').map((s) => s.trim()).filter(Boolean);
	const multi = segments.length > 1;
	const values: NormalizedValue[] = [];
	const warnings: Issue[] = [];
	for (const segment of segments) {
		const stripped = segment.replace(/[\s ‐-―−-]/g, '');
		const transforms: Transform[] = multi ? ['split-multi-value'] : [...base];
		if (stripped !== segment) transforms.push('strip-separators');
		let value = stripped;
		if (field === 'niin' && cell.kind === 'number' && /^\d{1,8}$/.test(value)) {
			value = value.padStart(9, '0');
			transforms.push('restore-leading-zeros');
			warnings.push(warn(`NIIN in ${at} is stored as a number; restored leading zeros to ${value}`));
		}
		if (!new RegExp(`^\\d{${DIGITS[field]}}$`).test(value))
			return invalid(`${field.toUpperCase()} "${text}" in ${at} is not ${DIGITS[field]} digits`);
		values.push({ value, transforms });
	}
	return { kind: 'ok', values, warnings };
}
