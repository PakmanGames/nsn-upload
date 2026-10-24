/**
 * SheetJS cell -> contract `Cell`.
 *
 * This is the one place that decides what text a cell shows. Every identifier downstream is read from `Cell.text`,
 * so numbers are rendered from the raw value, and SheetJS's formatted text `w` is used only where it is provably
 * what the user sees.
 */
import type { CellObject } from 'xlsx';
import type { Cell } from '../model';
import { toA1 } from '../refs';

/** Null when the stored cell has neither a value nor a formula, as with styled empty cells. */
export function toCell(
	source: CellObject,
	row: number,
	col: number,
	isDateFormat: (format: string) => boolean
): Cell | null {
	const cell: Cell = { ref: toA1(row, col), row, col, kind: 'empty', text: '', raw: null };
	const numFmt = typeof source.z === 'string' && source.z !== 'General' ? source.z : undefined;
	if (numFmt) cell.numFmt = numFmt;
	if (source.f) cell.formula = source.f;

	switch (source.t) {
		case 's': {
			// Rich text and formula strings (t="str") both arrive here with plain text in v.
			const text = String(source.v ?? '').replace(/\r\n?/g, '\n');
			if (text !== '') Object.assign(cell, { kind: 'text', text, raw: source.v });
			break;
		}
		case 'n':
			if (typeof source.v !== 'number') break;
			if (numFmt && isDateFormat(numFmt)) {
				// Dates keep the Excel serial in raw; the text is the date as formatted in the workbook.
				Object.assign(cell, { kind: 'date', text: source.w ?? String(source.v), raw: source.v });
			} else {
				Object.assign(cell, { kind: 'number', text: numberText(source.v, source.w), raw: source.v });
			}
			break;
		case 'b':
			Object.assign(cell, { kind: 'boolean', text: source.v ? 'TRUE' : 'FALSE', raw: Boolean(source.v) });
			break;
		case 'e':
			// A formula whose result was never cached can arrive as an error cell without a value: that is empty.
			if (source.v !== undefined) Object.assign(cell, { kind: 'error', raw: source.w ?? null });
			break;
		// 'z' stubs carry no value. Their v is unreliable: a formula without a cached result reads as t: 'z', v: 0.
	}

	return cell.kind === 'empty' && cell.formula === undefined ? null : cell;
}

/**
 * Integers are printed digit by digit from the raw value, because General-format text turns a 13-digit NSN into
 * "5.30502E+12". The formatted text wins only when it is the same integer with leading zeros (a NIIN shown through
 * format 000000000), since those zeros are what the user sees and identifiers need them.
 */
function numberText(value: number, formatted: string | undefined): string {
	if (!Number.isInteger(value)) return String(value);
	// BigInt prints every integer digit; String() switches to exponent form at 1e21.
	const exact = BigInt(value).toString();
	if (formatted !== undefined && /^0\d+$/.test(formatted) && BigInt(formatted) === BigInt(value)) return formatted;
	return exact;
}
