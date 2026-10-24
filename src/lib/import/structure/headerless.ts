/**
 * Tables without a header row: a bare list of NSNs in column A, or identifiers right below a title.
 *
 * Without header text only the values can name a column, so the value-only rule of `confidenceFor`
 * (columns.ts) decides alone: an NSN or NIIN column with at least 3 values, at least 95% of them valid, maps at
 * medium confidence. Every other column is evaluated the same way and stays unmapped unless it passes.
 */
import type { Cell, CellRange, Field, SheetModel } from '../model';
import { colLetter } from '../refs';
import { assignFields, describeEvidence, evaluateColumns, isPrimary, readHeader, type ColumnHeader } from './columns';
import type { Detection } from './detect';
import { formatRows } from './table';
import { checkValue } from './values';

/** Non-empty rows from the top in which the first NSN or NIIN is looked for, as for a header row. */
const START_SEARCH_ROWS = 30;
/** Rows that decide the mapping; materializeTable() then scores the table on every row. */
const SAMPLE_ROWS = 200;

type Span = { left: number; right: number };

const isIdentifier = (sheet: SheetModel, cell: Cell) =>
	checkValue('nsn', cell, sheet.name) === 'pass' || checkValue('niin', cell, sheet.name) === 'pass';

/** Visible cells holding a value of their own, left to right: a merged cell counts once, at its master. */
function valueCells(sheet: SheetModel, row: number, span: Span): Cell[] {
	const cells: Cell[] = [];
	for (let col = span.left; col <= span.right; col++) {
		if (sheet.hiddenCols.has(col)) continue;
		const cell = sheet.cell(row, col);
		if (cell.kind !== 'empty' && !cell.mergedFrom) cells.push(cell);
	}
	return cells;
}

/** The first row near the top holding an NSN or NIIN: titles and notes above it are not part of the table. */
function firstIdentifierRow(sheet: SheetModel, extent: CellRange, span: Span): number | null {
	let nonEmpty = 0;
	for (let row = extent.top; row <= extent.bottom && nonEmpty < START_SEARCH_ROWS; row++) {
		if (sheet.hiddenRows.has(row)) continue;
		const cells = valueCells(sheet, row, span);
		if (cells.length === 0) continue;
		nonEmpty++;
		if (cells.some((cell) => isIdentifier(sheet, cell))) return row;
	}
	return null;
}

/**
 * A table without a header row, or null when no column's values identify it.
 *
 * Detection asks when it found no header row, and when the row it would use as the header holds NSN or NIIN
 * values (`headerRow`): a row of identifiers is the first data row, however much of it reads like labels.
 */
export function detectHeaderless(sheet: SheetModel, extent: CellRange, span: Span, headerRow?: number): Detection | null {
	if (headerRow !== undefined && !valueCells(sheet, headerRow, span).some((cell) => isIdentifier(sheet, cell))) return null;
	const top = firstIdentifierRow(sheet, extent, span);
	if (top === null) return null;

	// The table spans the columns with values from its first row down; a title above it may be wider.
	const sample: number[] = [];
	let left = span.right;
	let right = span.left;
	for (let row = top; row <= extent.bottom; row++) {
		if (sheet.hiddenRows.has(row)) continue;
		const cells = valueCells(sheet, row, span);
		if (cells.length === 0) continue;
		if (sample.length < SAMPLE_ROWS) sample.push(row);
		left = Math.min(left, cells[0].col);
		right = Math.max(right, cells.at(-1)!.col);
	}
	const headers = new Map<number, ColumnHeader>();
	for (let col = left; col <= right; col++) headers.set(col, readHeader(sheet, [], col));
	const assigned = assignFields(evaluateColumns(sheet, headers, sample));
	if (![...assigned.values()].some((e) => isPrimary(e.field))) return null;

	const columns: Record<number, Field> = {};
	for (const [col, e] of assigned) columns[col] = e.field;
	const above: number[] = [];
	for (let row = extent.top; row < top; row++) {
		if (!sheet.hiddenRows.has(row) && valueCells(sheet, row, span).length > 0) above.push(row);
	}
	const reasons =
		above.length > 0
			? [`${above.length === 1 ? 'Row' : 'Rows'} ${formatRows(above)} above the first NSN or NIIN ${above.length === 1 ? 'is' : 'are'} not imported`]
			: [];
	return { spec: { headerRows: [], range: { top, left, bottom: extent.bottom, right }, columns }, reasons };
}

/**
 * Why a column of a proposed table without a header row cannot be mapped, or null when every column's values
 * identify its field. The AI verifier holds proposals to the same rule as detection with it.
 */
export function unsupportedByValues(sheet: SheetModel, range: CellRange, columns: ReadonlyMap<number, Field>): string | null {
	const rows: number[] = [];
	for (let row = range.top; row <= range.bottom; row++) if (!sheet.hiddenRows.has(row)) rows.push(row);
	const headers = new Map([...columns.keys()].map((col) => [col, readHeader(sheet, [], col)]));
	for (const column of evaluateColumns(sheet, headers, rows, { mapped: columns })) {
		const field = columns.get(column.col)!;
		const evidence = column.fields.get(field)!;
		if (!evidence.confidence) {
			const values = describeEvidence(column, evidence).at(-1);
			return `Column ${colLetter(column.col)} (${field}) has no header row, and its values alone are not enough to map it (${values})`;
		}
	}
	return null;
}
