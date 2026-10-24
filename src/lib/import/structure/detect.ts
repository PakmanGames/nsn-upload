/**
 * Deterministic table detection: which row is the header, which columns map to which field, where data ends.
 *
 * Every header-like row near the top is tried; each is scored by the mapping its columns would get from
 * header text and a sample of the values below it. Title rows lose because they map nothing.
 */
import type { CellRange, Field, SheetModel, TableSpec } from '../model';
import { colLetter } from '../refs';
import {
	assignFields,
	describeEvidence,
	evaluateColumns,
	FIELD_LABEL,
	isPrimary,
	tierOf,
	type ColumnEvidence,
	type FieldEvidence
} from './columns';
import { matchHeader, normalizeHeader } from './header';
import { checkValue } from './values';

/** Non-empty rows from the top of the value extent in which a header is looked for. */
const HEADER_SEARCH_ROWS = 30;
/** Rows below a candidate header used to score it; the chosen table is then scored on all rows. */
const SAMPLE_ROWS = 200;
/** Columns analyzed per sheet; a stray value far to the right must not make detection scan millions of cells. */
export const MAX_COLUMNS = 256;
/** "Mostly short text": share of a row's cells that must read like header labels. */
const HEADER_TEXT_SHARE = 0.75;
const HEADER_TEXT_MAX_LENGTH = 60;

export type Detection = {
	/** Null when no header row maps a primary field. */
	spec: TableSpec | null;
	/** Why nothing was found, or notes about other header-like regions. */
	reasons: string[];
};

type Span = { left: number; right: number };

/** A header cell as later rows are compared against it to recognize repeats. */
type HeaderKey = { col: number; key: string; strongFields: ReadonlySet<Field> };

type Trial = {
	row: number;
	span: Span;
	keys: HeaderKey[];
	columns: ColumnEvidence[];
	assigned: Map<number, FieldEvidence>;
	score: number;
	hasPrimary: boolean;
};

/** Visible, non-covered cells: a merged title counts once, not once per column it spans. */
function masterCells(sheet: SheetModel, row: number, span: Span) {
	const cells = [];
	for (let col = span.left; col <= span.right; col++) {
		if (sheet.hiddenCols.has(col)) continue;
		const cell = sheet.cell(row, col);
		if (cell.kind !== 'empty' && !cell.mergedFrom) cells.push(cell);
	}
	return cells;
}

const isIdentifier = (sheet: SheetModel, cell: ReturnType<SheetModel['cell']>) =>
	checkValue('nsn', cell, sheet.name) === 'pass' || checkValue('niin', cell, sheet.name) === 'pass';

function isHeaderLike(sheet: SheetModel, row: number, span: Span): boolean {
	const cells = masterCells(sheet, row, span);
	if (cells.length === 1) {
		// A lone cell is a header only for a one-column list (`NSN`), never a merged title spanning columns.
		const [cell] = cells;
		const spansColumns = sheet.cell(row, cell.col + 1).mergedFrom === cell.ref;
		return !spansColumns && cell.kind === 'text' && matchHeader(cell.text).some((m) => m.strength === 'strong');
	}
	if (cells.length < 2) return false;
	// Labels are short text; digits without letters (`5305`, `2026-07-17`) are data, while `#` is a label.
	const labels = cells.filter(
		(cell) =>
			cell.kind === 'text' &&
			cell.text.trim().length <= HEADER_TEXT_MAX_LENGTH &&
			(/\p{L}/u.test(cell.text) || !/\d/.test(cell.text)) &&
			!isIdentifier(sheet, cell)
	);
	return labels.length >= 2 && labels.length >= cells.length * HEADER_TEXT_SHARE;
}

function headerKeys(sheet: SheetModel, row: number, span: Span): HeaderKey[] {
	return masterCells(sheet, row, span).map((cell) => ({
		col: cell.col,
		key: normalizeHeader(cell.text),
		strongFields: new Set(matchHeader(cell.text).filter((m) => m.strength === 'strong').map((m) => m.field))
	}));
}

/** Most header cells come back, by text or by naming the same field (`Part No.` under `P/N`). */
function repeatsHeader(sheet: SheetModel, row: number, keys: readonly HeaderKey[]): boolean {
	const named = keys.filter((k) => k.strongFields.size > 0);
	const compared = named.length > 0 ? named : keys;
	const hits = compared.filter(({ col, key, strongFields }) => {
		const text = sheet.cell(row, col).text;
		return normalizeHeader(text) === key || matchHeader(text).some((m) => m.strength === 'strong' && strongFields.has(m.field));
	});
	return hits.length * 2 > compared.length;
}

/**
 * A row that could head a different table: header-like, no NSN/NIIN values, at least two label cells that
 * strongly name a field, and not a repeat of the current header. The bar is high because stopping a table
 * early drops real rows.
 */
function startsOtherTable(sheet: SheetModel, row: number, span: Span, keys: readonly HeaderKey[]): boolean {
	if (sheet.hiddenRows.has(row) || !isHeaderLike(sheet, row, span)) return false;
	const cells = masterCells(sheet, row, span);
	if (cells.some((cell) => isIdentifier(sheet, cell))) return false;
	const labels = cells.filter((cell) => matchHeader(cell.text).some((m) => m.strength === 'strong'));
	return labels.length >= 2 && !repeatsHeader(sheet, row, keys);
}

function headerCandidates(sheet: SheetModel, extent: CellRange, span: Span): number[] {
	const rows: number[] = [];
	let nonEmpty = 0;
	for (let row = extent.top; row <= extent.bottom && nonEmpty < HEADER_SEARCH_ROWS; row++) {
		if (sheet.hiddenRows.has(row) || masterCells(sheet, row, span).length === 0) continue;
		nonEmpty++;
		if (isHeaderLike(sheet, row, span)) rows.push(row);
	}
	return rows;
}

function tryHeader(sheet: SheetModel, row: number, extent: CellRange, sheetSpan: Span): Trial {
	let left = sheetSpan.right;
	let right = sheetSpan.left;
	for (let col = sheetSpan.left; col <= sheetSpan.right; col++) {
		if (sheet.cell(row, col).kind === 'empty') continue;
		left = Math.min(left, col);
		right = col;
	}
	const span = { left, right };
	const keys = headerKeys(sheet, row, span);
	// The sample ends where another table starts, so a stacked table does not score against this header.
	const sample: number[] = [];
	for (let r = row + 1; r <= extent.bottom && sample.length < SAMPLE_ROWS; r++) {
		if (sheet.hiddenRows.has(r) || masterCells(sheet, r, span).length === 0) continue;
		if (startsOtherTable(sheet, r, span, keys)) break;
		sample.push(r);
	}
	const headers = new Map<number, string>();
	for (let col = left; col <= right; col++) headers.set(col, sheet.cell(row, col).text.trim());
	const columns = evaluateColumns(sheet, headers, sample, { skipHeaderEcho: true });
	const assigned = assignFields(columns);
	// Each mapped column adds its confidence tier, primary fields one more. Ties go to the earliest row.
	let score = 0;
	for (const e of assigned.values()) score += tierOf(e.confidence!) + (isPrimary(e.field) ? 1 : 0);
	return { row, span, keys, columns, assigned, score, hasPrimary: [...assigned.values()].some((e) => isPrimary(e.field)) };
}

/** First row below the table's header that starts another table with a high-confidence primary column. */
function nextTable(sheet: SheetModel, trial: Trial, extent: CellRange, sheetSpan: Span): Trial | null {
	for (let row = trial.row + 1; row <= extent.bottom; row++) {
		if (!startsOtherTable(sheet, row, trial.span, trial.keys)) continue;
		const next = tryHeader(sheet, row, extent, sheetSpan);
		if ([...next.assigned.values()].some((e) => isPrimary(e.field) && e.confidence === 'high')) return next;
	}
	return null;
}

function nearMisses(trial: Trial): string[] {
	return trial.columns
		.filter((column) => !column.hidden)
		.flatMap((column) =>
			[...column.fields.values()]
				.filter((e) => e.header)
				.map((e) => `Row ${trial.row}, column ${colLetter(column.col)}: ${describeEvidence(column, e).join('; ')}`)
		);
}

export function detectTable(sheet: SheetModel): Detection {
	const extent = sheet.valueExtent;
	if (!extent) return { spec: null, reasons: ['Sheet has no values'] };
	const sheetSpan = { left: extent.left, right: Math.min(extent.right, extent.left + MAX_COLUMNS - 1) };
	const notes =
		sheetSpan.right < extent.right ? [`Only columns ${colLetter(sheetSpan.left)}-${colLetter(sheetSpan.right)} were analyzed`] : [];

	const trials = headerCandidates(sheet, extent, sheetSpan).map((row) => tryHeader(sheet, row, extent, sheetSpan));
	const best = trials.reduce<Trial | null>((b, t) => (!b || t.score > b.score ? t : b), null);
	if (!best) return { spec: null, reasons: [...notes, 'No header row found: no row near the top has at least two short text labels'] };
	if (!best.hasPrimary) {
		const misses = nearMisses(best);
		return {
			spec: null,
			reasons: [
				...notes,
				'No column holds part numbers, NSNs, or NIINs under a matching header',
				...(misses.length > 0 ? misses : [`Row ${best.row} looks like a header, but none of its columns names Part, NSN, or NIIN`])
			]
		};
	}

	for (const other of trials) {
		if (other.row < best.row && other.hasPrimary) {
			notes.push(`Row ${other.row} also looks like a header, but row ${best.row} fits the values better; rows above ${best.row} are not imported`);
		}
	}
	let bottom = extent.bottom;
	const next = nextTable(sheet, best, extent, sheetSpan);
	if (next) {
		bottom = next.row - 1;
		const fields = [...next.assigned.values()].map((e) => FIELD_LABEL[e.field]);
		notes.push(
			`Row ${next.row} starts another table (${fields.join(', ')}); only one table per sheet is imported, so rows ${next.row}-${extent.bottom} are not`
		);
	}

	const columns: Record<number, Field> = {};
	for (const [col, e] of best.assigned) columns[col] = e.field;
	return {
		spec: { headerRows: [best.row], range: { top: best.row, left: best.span.left, bottom, right: best.span.right }, columns },
		reasons: notes
	};
}
