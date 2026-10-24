/**
 * The cells behind each thing the review shows, as a SheetFocus for the spreadsheet view.
 *
 * V1 wires two sources: a row in the Rows preview (recordsFocus) and a cell reference in the provenance drawer
 * (refsFocus). V2's hover handlers call the same builders for a table line (tableFocus), a column card
 * (columnFocus), a decision (refsFocus with Decision.cells), and a "Worth a look" line (recordsFocus).
 */
import type { CandidateRecord, CellRange, TableCandidate } from '$lib/import/model';
import { colLetter, parseA1, rangeToA1, toA1 } from '$lib/import/refs';
import type { SheetFocus } from '$lib/import/session.svelte';

type At = { row: number; col: number };

/** One range per run of adjacent columns in a row, in reading order; duplicates collapse. */
export function cellsToRanges(cells: At[]): CellRange[] {
	const sorted = [...cells].sort((a, b) => a.row - b.row || a.col - b.col);
	const ranges: CellRange[] = [];
	for (const { row, col } of sorted) {
		const last = ranges.at(-1);
		if (last && last.top === row && col <= last.right + 1) last.right = Math.max(last.right, col);
		else ranges.push({ top: row, left: col, bottom: row, right: col });
	}
	return ranges;
}

/**
 * The cells records were read from: each value's cell in the record's row (a merged value's cell grows to its
 * merge in the view) and each rejected cell. Records on other sheets than the first one are left out.
 */
export function recordsFocus(records: CandidateRecord[]): SheetFocus | null {
	const sheet = records[0]?.sheet;
	if (sheet === undefined) return null;
	const cells: At[] = [];
	const rows = new Set<number>();
	for (const record of records) {
		if (record.sheet !== sheet) continue;
		rows.add(record.sourceRow);
		for (const value of Object.values(record.fields)) cells.push(value.provenance);
		for (const rejected of Object.values(record.rejected)) {
			const at = parseA1(rejected.cell);
			if (at) cells.push(at);
		}
	}
	const [first, ...more] = [...rows].sort((a, b) => a - b);
	return {
		sheet,
		ranges: cellsToRanges(cells),
		reason: more.length ? `${sheet} rows ${first}-${more.at(-1)}` : `${sheet} row ${first}`
	};
}

/** Qualified refs ("Active Parts!E134"), as in Issue.cells and Decision.cells; cells on other sheets than the first ref's are left out. */
export function refsFocus(refs: string[]): SheetFocus | null {
	const parsed = refs.flatMap((ref) => {
		// A sheet name may contain "!", a cell ref never does.
		const bang = ref.lastIndexOf('!');
		const at = parseA1(ref.slice(bang + 1));
		return bang > 0 && at ? [{ sheet: ref.slice(0, bang), ...at }] : [];
	});
	const sheet = parsed[0]?.sheet;
	if (sheet === undefined) return null;
	const ranges = cellsToRanges(parsed.filter((cell) => cell.sheet === sheet));
	return { sheet, ranges, reason: `${sheet} ${ranges.map(rangeRef).join(', ')}` };
}

/** "E134" for one cell, "D136:F136" for more. */
export const rangeRef = (range: CellRange) =>
	range.top === range.bottom && range.left === range.right ? toA1(range.top, range.left) : rangeToA1(range);

/** The grid's own cursor. No reason: the user is already looking at the cell, so there is nothing to announce. */
export function cellFocus(sheet: string, row: number, col: number): SheetFocus {
	return { sheet, ranges: [{ top: row, left: col, bottom: row, right: col }] };
}

export function tableFocus(table: TableCandidate): SheetFocus {
	return { sheet: table.sheet, ranges: [table.range], reason: `${table.sheet} ${rangeToA1(table.range)}` };
}

/** A column within its table's range, header included. */
export function columnFocus(table: TableCandidate, col: number): SheetFocus {
	const { top, bottom } = table.range;
	return { sheet: table.sheet, ranges: [{ top, left: col, bottom, right: col }], reason: `${table.sheet} column ${colLetter(col)}` };
}
