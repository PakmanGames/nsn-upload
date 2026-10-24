/**
 * Where a table ends and which columns belong to it: rows under a blank gap that fit none of the table's
 * columns, headers merged across columns, and values beside the header in columns nobody labeled.
 */
import { describe, expect, it } from 'vitest';
import type { TableCandidate } from '../model';
import { colLetter } from '../refs';
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure } from '.';

const nsn = (i: number) => `5305-01-${String(100 + i).padStart(3, '0')}-${2000 + i}`;
/** Inclusive run of row numbers. */
const run = (first: number, last: number) => Array.from({ length: last - first + 1 }, (_, i) => first + i);
const parts = (n: number, from = 0): CellInput[][] => Array.from({ length: n }, (_, i) => [`SE58${from + i}`, nsn(from + i)]);

function tableFor(rows: CellInput[][], merges: string[] = []): TableCandidate {
	const [sheet] = analyzeStructure(makeWorkbook('test.xlsx', [makeSheet('Parts', rows, { merges })]), {});
	expect(sheet.tables).toHaveLength(1);
	return sheet.tables[0];
}

const letters = (table: TableCandidate) => table.columns.map((c) => colLetter(c.col));
const below = (...rows: number[]) => rows.map((row) => ({ row, reason: 'below-table' }));

describe('end of the table', () => {
	// A supplier form and a terms paragraph under the table, as RFI response sheets have.
	const form: CellInput[][] = [
		['Supplier Information'],
		['Field'],
		['Supplier_Name'],
		['Point_Of_Contact_Email'],
		[],
		['Contract terms: quantities are guaranteed by year-end and paid on delivery, not upfront.']
	];

	it('ends at a blank gap followed by rows that fit none of the columns, and names those rows', () => {
		const table = tableFor([['Part Number', 'NSN'], ...parts(10), [], [], ...form], ['A14:B14', 'A19:B19']);
		expect(table.range).toEqual({ top: 1, left: 1, bottom: 11, right: 2 });
		expect(table.dataRows).toEqual(run(2, 11));
		// The rows left out stay listed, so the user can check nothing was lost; the blank rows are only spacing.
		expect(table.skippedRows).toEqual(below(14, 15, 16, 17, 19));
		expect(table.reasons).toContain(
			"The table ends at row 11: rows 14-19, after the blank rows 12-13, have no part number, NSN, or NIIN, so they aren't imported"
		);
		expect(table.reasons.join('\n')).not.toMatch(/^Skipped/m);
		// The form's labels no longer count against the Part column.
		expect(table.columns.map((c) => [c.field, c.confidence, c.valuePassRate])).toEqual([
			['part', 'high', 1],
			['nsn', 'high', 1]
		]);
	});

	// Known gap: detection scores a header on the rows below it before the end of the table is known, so when
	// the rows under the gap outnumber a column's data, that column is never mapped (here 3 parts against 5
	// form labels in column A). Applying the same end rule to detection's sample would map it.
	it.fails('maps a column whose rows below the end outnumber its data rows', () => {
		const table = tableFor([['Part Number', 'NSN'], ...parts(3), [], [], ...form]);
		expect(table.columns[0]).toMatchObject({ field: 'part', confidence: 'high' });
	});

	it('says "row" for a single row under a single blank row', () => {
		const table = tableFor([['Part Number', 'NSN'], ...parts(3), [], ['Prepared by the purchasing office']]);
		expect(table.range.bottom).toBe(4);
		expect(table.skippedRows).toEqual(below(6));
		expect(table.reasons).toContain(
			"The table ends at row 4: row 6, after the blank row 5, has no part number, NSN, or NIIN, so it isn't imported"
		);
	});

	it('never cuts above a row with a valid NSN, even in a column that is not mapped', () => {
		const rows: CellInput[][] = [['Part Number', 'NSN', 'Notes'], ...parts(3), [], ['See also', null, nsn(9)]];
		const table = tableFor(rows);
		expect(table.range.bottom).toBe(6);
		expect(table.dataRows).toEqual([2, 3, 4, 6]);
		expect(table.reasons.join('\n')).not.toMatch(/do(es)? not fit/);
	});

	it('never cuts above a row whose mapped value passes, so a second block without a header stays', () => {
		const table = tableFor([['Part Number', 'NSN'], ...parts(3), [], [], ['Field'], [], ['SE5899', null]]);
		expect(table.range.bottom).toBe(9);
		expect(table.dataRows).toEqual([2, 3, 4, 7, 9]);
	});

	it('keeps a misfit row inside the data run as a data row, and cuts only at the gap below it', () => {
		const rows: CellInput[][] = [['Part Number', 'NSN'], ...parts(10), ['Call supplier for lead time'], [], ...form];
		const table = tableFor(rows);
		expect(table.range.bottom).toBe(12);
		expect(table.dataRows).toEqual(run(2, 12));
		expect(table.reasons).toContain(
			"The table ends at row 12: rows 14-19, after the blank row 13, have no part number, NSN, or NIIN, so they aren't imported"
		);

		const noGap = tableFor([['Part Number', 'NSN'], ...parts(3), ['Call supplier for lead time']]);
		expect(noGap.dataRows).toEqual([2, 3, 4, 5]);
	});

	it('treats a repeated header after a gap as a repeated header, not as an end', () => {
		const header: CellInput[] = ['Part Number', 'NSN'];
		const trailing = tableFor([header, ...parts(3), [], header]);
		expect(trailing.range.bottom).toBe(6);
		expect(trailing.skippedRows).toEqual([
			{ row: 5, reason: 'blank' },
			{ row: 6, reason: 'repeated-header' }
		]);

		// The table still ends at a later gap that only misfit rows follow.
		const blocks = tableFor([header, ...parts(6), [], header, ...parts(6, 6), [], ...form]);
		expect(blocks.range.bottom).toBe(15);
		expect(blocks.dataRows).toEqual([...run(2, 7), ...run(10, 15)]);
		expect(blocks.skippedRows).toEqual([
			{ row: 8, reason: 'blank' },
			{ row: 9, reason: 'repeated-header' },
			...below(17, 18, 19, 20, 22)
		]);
		expect(blocks.reasons).toContain('Skipped 1 blank row (8), 1 repeated header row (9)');
	});

	it('keeps a misfit block between two parts of the data, since rows below it still fit', () => {
		const table = tableFor([['Part Number', 'NSN'], ...parts(2), [], ['Hydraulics'], [], ...parts(2, 2)]);
		expect(table.range.bottom).toBe(8);
		expect(table.dataRows).toEqual([2, 3, 5, 7, 8]);
	});

	it('leaves trailing blank rows in the range when nothing follows them', () => {
		// detectTable stops a table above a stacked second one, which can leave blank rows at the bottom.
		const rows: CellInput[][] = [['Part Number', 'NSN'], ...parts(2), [], ['NIIN', 'CAGE'], ['016582565', '0BWZ1']];
		const table = tableFor(rows);
		expect(table.range.bottom).toBe(4);
		expect(table.skippedRows).toEqual([{ row: 4, reason: 'blank' }]);
	});
});

describe('columns without a header', () => {
	it('adds values beside the header as columns without a header, listed but not mapped', () => {
		const rows: CellInput[][] = [
			['Part Number', 'NSN'],
			['SE5826', nsn(0), 'Tronson', 'JESSICA@TRONSON.EXAMPLE'],
			['RC 620', nsn(1), 'Welch machine'],
			['UTU44013', nsn(2), 'Ahlers aerospace']
		];
		const table = tableFor(rows);
		expect(table.range).toEqual({ top: 1, left: 1, bottom: 4, right: 4 });
		expect(letters(table)).toEqual(['A', 'B', 'C', 'D']);
		for (const column of table.columns.slice(2)) {
			expect(column).toMatchObject({ header: '', field: null, alternatives: [] });
			expect(column.reasons).toEqual(["No header, and its values aren't NSNs or NIINs"]);
		}
		expect(table.status).toBe('ready');
	});

	it('maps an unlabeled column of NSNs from its values, so it still imports', () => {
		const rows: CellInput[][] = [['Part Number', 'Description'], ...[0, 1, 2].map((i) => [`SE58${i}`, 'Screw, machine', nsn(i)])];
		const table = tableFor(rows);
		expect(table.columns[2]).toMatchObject({ col: 3, header: '', field: 'nsn', confidence: 'medium' });
		expect(table.columns[2].reasons).toEqual(['No header text', '3 of 3 values are valid NSNs']);
	});

	it('adds an unlabeled column on the left as well', () => {
		const rows: CellInput[][] = [[null, 'Part Number', 'NSN'], ...parts(3).map((row, i) => [i + 1, ...row])];
		const table = tableFor(rows);
		expect(table.range.left).toBe(1);
		expect(table.columns[0]).toMatchObject({ col: 1, header: '', field: null });
	});

	it('leaves out a column with neither a header nor values', () => {
		const rows: CellInput[][] = [['Part Number', null, 'NSN'], ...parts(3).map(([part, value]) => [part, null, value])];
		expect(letters(tableFor(rows))).toEqual(['A', 'C']);
	});

	it('does not take in a column whose only values are in rows below the end of the table', () => {
		const rows: CellInput[][] = [['Part Number', 'NSN'], ...parts(3), [], ['Supplier_Name', null, null, 'Acme']];
		const table = tableFor(rows);
		expect(table.range).toEqual({ top: 1, left: 1, bottom: 4, right: 2 });
		expect(letters(table)).toEqual(['A', 'B']);
		expect(table.skippedRows).toEqual(below(6));
	});
});
