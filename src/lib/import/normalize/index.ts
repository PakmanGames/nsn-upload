import type { Cell, Field, NormalizeResult, Transform } from '../model';
import { qualifiedRef } from '../refs';
import { FIELD_RULES, invalid } from './fields';

/** A lone hyphen, Unicode dash, or minus sign is a placeholder for "no value". */
const DASH_ONLY = /^[-‐-―−]$/;

/**
 * Normalizes one cell for one target field.
 * Shared cleanup happens here (number to text, line endings, trim, dash placeholders, Excel
 * errors); field-specific rules live in ./fields.ts.
 */
export function normalizeField(field: Field, cell: Cell, sheet: string): NormalizeResult {
	if (cell.kind === 'empty') return { kind: 'empty' };
	const at = qualifiedRef(sheet, cell.ref);
	if (cell.kind === 'error') return invalid(field, at, `Excel error value ${cell.raw} in ${at}`);

	const transforms: Transform[] = cell.kind === 'number' ? ['numeric-to-text'] : [];
	let text = cell.text;
	const lf = text.replace(/\r\n?/g, '\n');
	if (lf !== text) transforms.push('normalize-line-endings');
	text = lf.trim();
	if (text !== lf) transforms.push('trim');
	if (text === '' || DASH_ONLY.test(text)) return { kind: 'empty' };

	return FIELD_RULES[field]({ cell, at, text, transforms });
}
