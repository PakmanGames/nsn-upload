/**
 * A1 reference helpers.
 *
 * Rows and columns are 1-based Excel coordinates, so every ref shown in the UI matches what users see in Excel.
 */
import type { Cell, CellRange } from './model';

/** Excel's grid limits: a ref beyond them cannot exist in any workbook. */
const MAX_ROW = 1_048_576;
const MAX_COL = 16_384;

/** 1 -> "A", 26 -> "Z", 27 -> "AA". Column letters are bijective base 26, so there is no zero digit. */
export function colLetter(col: number): string {
	let letters = '';
	for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) {
		letters = String.fromCharCode(65 + ((n - 1) % 26)) + letters;
	}
	return letters;
}

export function toA1(row: number, col: number): string {
	return `${colLetter(col)}${row}`;
}

/** Parses a single-cell ref such as "D136" (letters in any case). Null when malformed or outside Excel's grid. */
export function parseA1(ref: string): { row: number; col: number } | null {
	const match = /^([A-Z]{1,3})([1-9]\d{0,6})$/i.exec(ref);
	if (!match) return null;
	let col = 0;
	for (const letter of match[1].toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64;
	const row = Number(match[2]);
	return row <= MAX_ROW && col <= MAX_COL ? { row, col } : null;
}

export function rangeToA1(range: CellRange): string {
	return `${toA1(range.top, range.left)}:${toA1(range.bottom, range.right)}`;
}

/** Parses "A2:F180", or a single cell "B3". Corners may come in either order, as Excel allows. */
export function parseRange(a1: string): CellRange | null {
	const [first, second = first, ...rest] = a1.split(':');
	if (rest.length > 0) return null;
	const start = parseA1(first);
	const end = parseA1(second);
	if (!start || !end) return null;
	return {
		top: Math.min(start.row, end.row),
		left: Math.min(start.col, end.col),
		bottom: Math.max(start.row, end.row),
		right: Math.max(start.col, end.col)
	};
}

/** "Active Parts" + "E134" -> "Active Parts!E134", the form used in Issue.cells and Decision.cells. */
export function qualifiedRef(sheet: string, ref: string): string {
	return `${sheet}!${ref}`;
}

export function emptyCell(row: number, col: number): Cell {
	return { ref: toA1(row, col), row, col, kind: 'empty', text: '', raw: null };
}
