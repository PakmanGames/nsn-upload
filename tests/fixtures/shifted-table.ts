/**
 * Expectations for ShiftedTable.xlsx: the Statz workbook with its second half moved four columns right, so one
 * sheet holds two tables. Every number was recounted from the file with SheetJS.
 *
 * The records must be Statz's records, so `statz` in expectations.ts is the oracle for the part and NSN pairs,
 * the importable count, the FSC groups, and the parts with several NSNs; nothing here retypes them.
 */
import type { Field, ImportSummary, SkippedRow } from '../../src/lib/import/model';
import { rows, statz } from './expectations';

export type ShiftedTableExpectation = {
	/** Suffix of the table id: `${sheet}@${headerRow}`. */
	id: string;
	/** A1 range, header row through last data row. */
	range: string;
	headerRows: number[];
	/** Every mapped column as field -> column letter. */
	mapping: Partial<Record<Field, string>>;
	dataRows: number[];
	skippedRows: SkippedRow[];
	records: number;
};

export const shiftedTable = {
	file: 'ShiftedTable.xlsx',
	/** Excel's 31-character limit cut the Statz title short. */
	sheet: 'Statz - List of active Geier an',
	tables: [
		// Column C is headed "Part Number" but holds NSNs, so it maps to NSN by its values, at medium confidence.
		{ id: '@1', range: 'A1:G31', headerRows: [1], mapping: { part: 'A', nsn: 'C' }, dataRows: rows(2, 31), skippedRows: [], records: 30 },
		{ id: '@34', range: 'E34:K58', headerRows: [34], mapping: { part: 'E', nsn: 'G' }, dataRows: rows(35, 58), skippedRows: [], records: 24 }
	] satisfies ShiftedTableExpectation[],
	/** Part cells stored as dates shown as `4-2002` (format m-yyyy); Statz holds the same values as text. */
	datePartCells: ['E43', ...rows(46, 58).map((row) => `E${row}`)],
	/** Statz's counts, with its one table now two. */
	initial: { ...statz.initial, tablesIncluded: 2 } satisfies Partial<ImportSummary>,
	oracle: statz
};
