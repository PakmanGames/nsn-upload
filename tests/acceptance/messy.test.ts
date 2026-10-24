/**
 * More unseen workbooks: the messy cases from PLAN.md and the design note that neither the fixtures nor
 * unseen.test.ts cover. Each test asserts the specified behavior (design note sections in the comments).
 * Where today's pipeline disagrees, the test is `it.fails` with a comment saying what should happen; the two
 * documented gaps (stacked tables, two-row headers) instead pin today's documented behavior.
 */
import { describe, expect, it } from 'vitest';
import { decisionId } from '../../src/lib/import/model';
import { toImportPlan } from '../../src/lib/import/validate';
import { rows } from '../fixtures/expectations';
import {
	digits,
	mappedColumns,
	NSN,
	recordAt,
	recordsOf,
	sheetOf,
	singleRecordAt,
	tableOf,
	useWorkbook
} from './helpers';

/** Excel stores a date as a serial number; ExcelJS writes a Date as one. 2026-03-04 is what typing "3-4" gives. */
const MARCH_4 = new Date(Date.UTC(2026, 2, 4));

describe('messy unseen workbooks', () => {
	describe('a part cell merged down across several NSN rows', () => {
		// Design note §11: explicit merges are filled; plain blank cells are not.
		const workbook = useWorkbook('merged-part.xlsx', [
			{
				name: 'Kits',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', NSN[0], 'Screw, machine'],
					[null, NSN[1], 'Screw, assembly'],
					[null, NSN[2], 'Guard, shock absorber'],
					['VLV-220', NSN[3], 'Valve, check'],
					['GSK-310', NSN[4], 'Gasket']
				],
				merges: ['A2:A4']
			}
		]);

		it('gives every covered row the merged part number, labeled as filled from A2', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Kits'))).toEqual({ part: 'A', nsn: 'B', description: 'C' });
			for (const row of [2, 3, 4]) {
				const record = singleRecordAt(workbook.analysis, 'Kits', row);
				expect(record.fields.part, `row ${row}`).toMatchObject({ value: 'BRK-1001', provenance: { cell: 'A2' } });
				expect(record.fields.nsn?.value, `row ${row}`).toBe(digits(NSN[row - 2]));
				expect(record.approved, `row ${row}`).toBe(true);
			}
			expect(singleRecordAt(workbook.analysis, 'Kits', 2).fields.part?.provenance.transforms).not.toContain('merge-fill');
			for (const row of [3, 4]) {
				expect(singleRecordAt(workbook.analysis, 'Kits', row).fields.part?.provenance.transforms).toContain('merge-fill');
			}
			expect(workbook.analysis.summary.toImport).toBe(5);
		});
	});

	describe('a 13-digit NSN typed as a number, and a numeric CAGE that lost its leading zero', () => {
		const workbook = useWorkbook('numeric-identifiers.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'CAGE Code', 'Description'],
					['BRK-1001', 5305016582565, 1234, 'Screw, machine'],
					['BRK-1002', NSN[1], '1ABC2', 'Screw, assembly'],
					['GRD-3001', NSN[2], '2DEF3', 'Guard, shock absorber'],
					['CAR-4001', NSN[3], '3GHJ4', 'Carrier, drive sprocket']
				]
			}
		]);

		it('reads the NSN exactly and restores the CAGE zero with a warning (§3)', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Parts'))).toEqual({
				part: 'A',
				nsn: 'B',
				cage: 'C',
				description: 'D'
			});
			const record = singleRecordAt(workbook.analysis, 'Parts', 2);
			expect(record.fields.nsn).toMatchObject({ value: '5305016582565', provenance: { original: '5305016582565' } });
			expect(record.fields.nsn?.provenance.transforms).toContain('numeric-to-text');
			expect(record.fields.cage).toMatchObject({ value: '01234', provenance: { cell: 'C2', original: '1234' } });
			expect(record.fields.cage?.provenance.transforms).toContain('restore-leading-zeros');
			expect(record.issues).toContainEqual(expect.objectContaining({ code: 'suspicious-value', field: 'cage' }));
			expect(record).toMatchObject({ status: 'warning', approved: true });
		});
	});

	describe('NSN labels, en dashes, and non-breaking spaces', () => {
		const written = ['NSN: 5305-01-658-2565', '5305–01–669–8021', '5340 01 102 4535', NSN[3]];
		const workbook = useWorkbook('nsn-variants.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					...written.map((nsn, i) => [`SCR-${100 + i}`, nsn, 'Screw, machine'])
				]
			}
		]);

		it('normalizes every variant to 13 digits and keeps the original text (§3)', () => {
			const nsnColumn = tableOf(workbook.analysis, 'Parts').columns.find((column) => column.field === 'nsn');
			expect(nsnColumn?.valuePassRate).toBe(1);
			written.forEach((original, i) => {
				const nsn = singleRecordAt(workbook.analysis, 'Parts', i + 2).fields.nsn;
				expect(nsn?.value, original).toBe([NSN[0], NSN[1], NSN[2], NSN[3]].map(digits)[i]);
				expect(nsn?.provenance.original, original).toBe(original);
				expect(nsn?.provenance.transforms, original).toContain('strip-separators');
			});
			const labeled = singleRecordAt(workbook.analysis, 'Parts', 2).fields.nsn;
			expect(labeled?.provenance.transforms).toContain('strip-label');
			expect(workbook.analysis.summary.toImport).toBe(4);
		});
	});

	describe('a totals row under the table', () => {
		const workbook = useWorkbook('order-with-total.xlsx', [
			{
				name: 'Order',
				rows: [
					['Part Number', 'NSN', 'Description', 'Qty'],
					['BRK-1001', NSN[0], 'Screw, machine', 10],
					['BRK-1002', NSN[1], 'Screw, assembly', 4],
					['GRD-3001', NSN[2], 'Guard, shock absorber', 2],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket', 6],
					['Total', null, null, { formula: 'SUM(D2:D5)', result: 22 }]
				]
			}
		]);

		// Should: a footer that only labels a sum ("Total" in the part column, nothing in NSN or Description) is not
		// a part record, so row 6 is skipped, the part column stays high confidence, and 4 valid records import.
		// Today row 6 imports as part "Total" with a plausibility warning (a known gap, design note §11), and it also
		// drags the part column to 4 of 5 plausible values, medium confidence, so every real row gets a
		// low-confidence-mapping warning. Finding for T3.
		it.fails('does not import the totals row as a part', () => {
			const part = tableOf(workbook.analysis, 'Order').columns.find((column) => column.field === 'part');
			expect(part?.confidence).toBe('high');
			expect(recordAt(workbook.analysis, 'Order', 6).filter((record) => record.approved)).toEqual([]);
			expect(workbook.analysis.summary).toMatchObject({ valid: 4, toImport: 4 });
		});
	});

	describe('a header on row 7 below a block of instructions', () => {
		const workbook = useWorkbook('template.xlsx', [
			{
				name: 'Upload',
				rows: [
					['Supplier part upload template'],
					['Instructions:'],
					['1. Enter one part number per row. Keep revision suffixes such as REV B.'],
					['2. NSN is the 13-digit National Stock Number; hyphens are optional.'],
					['3. Leave the CAGE code blank when the manufacturer is unknown.'],
					[],
					['Part Number', 'NSN', 'CAGE Code', 'Description'],
					['BRK-1001', NSN[0], '0BWZ1', 'Screw, machine'],
					['BRK-1002', NSN[1], '0BWZ1', 'Screw, assembly'],
					['GRD-3001', NSN[2], '1ABC2', 'Guard, shock absorber'],
					['CAR-4001', NSN[3], '1ABC2', 'Carrier, drive sprocket']
				]
			}
		]);

		it('finds the header on row 7 and imports only the rows below it (§1)', () => {
			const table = tableOf(workbook.analysis, 'Upload');
			expect(table).toMatchObject({ status: 'ready', headerRows: [7] });
			expect(mappedColumns(table)).toEqual({ part: 'A', nsn: 'B', cage: 'C', description: 'D' });
			expect(table.dataRows).toEqual(rows(8, 11));
			expect(workbook.analysis.summary.toImport).toBe(4);
		});
	});

	describe('a sheet with FSC and NIIN columns only', () => {
		const lines = [
			['5305', '016582565'],
			['5305', '016698021'],
			['5340', '011024535'],
			['3020', '016609619']
		];
		const workbook = useWorkbook('fsc-niin-only.xlsx', [{ name: 'NIINs', rows: [['FSC', 'NIIN'], ...lines] }]);

		it('imports each NIIN with an NSN derived from FSC + NIIN (§3)', () => {
			const table = tableOf(workbook.analysis, 'NIINs');
			expect(table.status).toBe('ready');
			expect(mappedColumns(table)).toEqual({ fsc: 'A', niin: 'B' });
			lines.forEach(([fsc, niin], i) => {
				const { fields, approved } = singleRecordAt(workbook.analysis, 'NIINs', i + 2);
				expect(fields.niin).toMatchObject({ value: niin, provenance: { origin: 'source' } });
				expect(fields.nsn).toMatchObject({ value: fsc + niin, provenance: { origin: 'derived' } });
				expect(approved).toBe(true);
			});
			const imported = toImportPlan(workbook.analysis).add.map((input) => input.nsn);
			expect(imported).toEqual(lines.map(([fsc, niin]) => fsc + niin));
		});
	});

	describe('formula cells with cached values, and #N/A errors, in identifier columns', () => {
		const lookup = (row: number) => `VLOOKUP(A${row},Catalog!A:B,2,FALSE)`;
		const workbook = useWorkbook('lookups.xlsx', [
			{
				name: 'Lookup',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', { formula: lookup(2), result: NSN[0] }, 'Screw, machine'],
					['BRK-1002', { formula: lookup(3), result: NSN[1] }, 'Screw, assembly'],
					['GRD-3001', { formula: lookup(4), result: { error: '#N/A' } }, 'Guard, shock absorber'],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket'],
					[{ formula: 'UPPER("hub-5001")', result: 'HUB-5001' }, NSN[4], 'Hub assembly, wheel'],
					['WSH-7001', { error: '#N/A' }, 'Washer, flat']
				]
			}
		]);

		it('reads cached formula results as values (§3)', () => {
			const lookedUp = singleRecordAt(workbook.analysis, 'Lookup', 2).fields.nsn;
			expect(lookedUp).toMatchObject({ value: digits(NSN[0]), provenance: { cell: 'B2', original: NSN[0] } });
			expect(singleRecordAt(workbook.analysis, 'Lookup', 6).fields.part?.value).toBe('HUB-5001');
		});

		it('rejects #N/A as a value, never treats it as empty, and still imports the part (§3)', () => {
			for (const row of [4, 7]) {
				const record = singleRecordAt(workbook.analysis, 'Lookup', row);
				expect(record.fields.nsn, `row ${row}`).toBeUndefined();
				expect(record.rejected.nsn?.cell, `row ${row}`).toBe(`B${row}`);
				const issue = record.issues.find((candidate) => candidate.code === 'invalid-identifier');
				expect(issue, `row ${row}`).toMatchObject({ field: 'nsn', cells: [`Lookup!B${row}`] });
				expect(issue?.message, `row ${row}`).toContain('#N/A');
				expect(record, `row ${row}`).toMatchObject({ status: 'warning', approved: true });
			}
			expect(workbook.analysis.summary.toImport).toBe(6);
		});
	});

	describe('a part number Excel turned into a date', () => {
		const workbook = useWorkbook('date-part.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					[MARCH_4, NSN[0], 'Spacer, sleeve'],
					[MARCH_4, null, 'Bracket, mounting'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber'],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket']
				],
				numFmts: { A2: 'd-mmm', A3: 'd-mmm' }
			}
		]);

		it('rejects the date and imports the NSN of that row (§3)', () => {
			const record = singleRecordAt(workbook.analysis, 'Parts', 2);
			expect(record.fields.part).toBeUndefined();
			expect(record.rejected.part).toEqual({ original: '4-Mar', cell: 'A2' });
			expect(record.issues).toContainEqual(expect.objectContaining({ code: 'invalid-identifier', field: 'part' }));
			expect(record.fields.nsn?.value).toBe(digits(NSN[0]));
			expect(record.approved).toBe(true);
		});

		it('leaves a row whose only identifier became a date out of the import', () => {
			const record = singleRecordAt(workbook.analysis, 'Parts', 3);
			expect(record).toMatchObject({ status: 'invalid', approved: false });
			expect(record.issues.map((issue) => issue.code)).toContain('missing-primary-identifier');
			expect(workbook.analysis.summary.toImport).toBe(4);
		});
	});

	describe('hidden (filtered) rows inside a table', () => {
		const workbook = useWorkbook('filtered.xlsx', [
			{
				name: 'Filtered',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', NSN[0], 'Screw, machine'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber'],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket'],
					['HUB-5001', NSN[4], 'Hub assembly, wheel']
				],
				hiddenRows: [3, 5]
			}
		]);

		it('skips and lists the hidden rows (D7)', () => {
			const table = tableOf(workbook.analysis, 'Filtered');
			expect(table.dataRows).toEqual([2, 4, 6]);
			expect(table.skippedRows).toEqual([
				{ row: 3, reason: 'hidden' },
				{ row: 5, reason: 'hidden' }
			]);
			expect(recordsOf(workbook.analysis, 'Filtered').map((record) => record.sourceRow)).toEqual([2, 4, 6]);
			expect(workbook.analysis.summary.toImport).toBe(3);
		});
	});

	describe('a multi-line NSN cell where one line is invalid', () => {
		const cell = `${NSN[0]}\n12345`;
		const workbook = useWorkbook('multi-line-nsn.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', cell, 'Screw, machine'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber'],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket']
				]
			}
		]);

		it('rejects the whole cell instead of splitting it, and imports the part (§3)', () => {
			expect(recordAt(workbook.analysis, 'Parts', 2)).toHaveLength(1);
			const record = singleRecordAt(workbook.analysis, 'Parts', 2);
			expect(record.split).toBeUndefined();
			expect(record.fields.nsn).toBeUndefined();
			expect(record.rejected.nsn).toEqual({ original: cell, cell: 'B2' });
			const issue = record.issues.find((candidate) => candidate.code === 'invalid-identifier');
			expect(issue?.message).toContain('12345');
			expect(record).toMatchObject({ approved: true, fields: { part: { value: 'BRK-1001' } } });
			const splits = workbook.analysis.decisions.filter((decision) => decision.kind === 'split-cell');
			expect(splits).toEqual([]);
		});
	});

	describe('the same part and NSN on two sheets with different CAGEs', () => {
		const header = ['Part Number', 'NSN', 'CAGE', 'Description'];
		const workbook = useWorkbook('two-suppliers.xlsx', [
			{
				name: 'East',
				rows: [header, ['BRK-1001', NSN[0], '1ABC2', 'Screw, machine'], ['GRD-3001', NSN[2], '1ABC2', 'Guard']]
			},
			{
				name: 'West',
				rows: [header, ['BRK-1001', NSN[0], '9XYZ8', 'Screw, machine'], ['CAR-4001', NSN[3], '9XYZ8', 'Carrier']]
			}
		]);

		it('keeps both as different items, because the CAGE differs (D8)', () => {
			const east = singleRecordAt(workbook.analysis, 'East', 2);
			const west = singleRecordAt(workbook.analysis, 'West', 2);
			for (const record of [east, west]) {
				expect(record, record.id).toMatchObject({ status: 'valid', approved: true });
				expect(record.mergedFrom, record.id).toBeUndefined();
			}
			// The table's include decision lists every record; only a duplicate or conflict decision would be wrong here.
			const involved = workbook.analysis.decisions.filter(
				(decision) => decision.kind !== 'include-table' && decision.recordIds.includes(east.id)
			);
			expect(involved).toEqual([]);
			expect(workbook.analysis.summary).toMatchObject({ duplicates: 0, conflicts: 0, toImport: 4 });
		});
	});

	describe('a malformed value above a repeated header', () => {
		// Found while building the demo workbooks: Statz's shape (a header repeated after blank rows) with one
		// typo in the first block.
		const workbook = useWorkbook('typo-before-repeat.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN'],
					['BRK-1001', NSN[0]],
					['BRK-1002', NSN[1]],
					['GRD-3001', NSN[2]],
					['HUB-6001', '12663107'],
					[],
					['Part Number', 'NSN'],
					['CAR-4001', NSN[3]],
					['HUB-5001', NSN[4]]
				]
			}
		]);

		// Should: row 1 is the header, row 7 is skipped as a repeated header (§1), all 6 parts import, and row 5's
		// NSN is rejected while its part imports. Today the one malformed NSN lowers row 1's score, so the repeated
		// header on row 7 is chosen and rows 2-5 are dropped with only a reason line. Finding for T3.
		it.fails('keeps the first header and imports both blocks', () => {
			const table = tableOf(workbook.analysis, 'Parts');
			expect(table.headerRows).toEqual([1]);
			expect(table.dataRows).toEqual([2, 3, 4, 5, 8, 9]);
			expect(table.skippedRows).toEqual([
				{ row: 6, reason: 'blank' },
				{ row: 7, reason: 'repeated-header' }
			]);
			expect(workbook.analysis.summary.toImport).toBe(6);
		});
	});

	describe('documented gap: two different tables stacked on one sheet', () => {
		// Design note §1 and §11: one table per sheet. Data stops before a clearly different table's header,
		// which is named in the sheet's reasons and not imported.
		const workbook = useWorkbook('stacked.xlsx', [
			{
				name: 'Stacked',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['BRK-1001', NSN[0], 'Screw, machine'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber'],
					[],
					['NIIN', 'Item Name', 'CAGE Code'],
					['016609619', 'Carrier, drive sprocket', '1ABC2'],
					['009673346', 'Hub assembly, wheel', '1ABC2'],
					['011066157', 'Spring, helical', '2DEF3']
				]
			}
		]);

		it('imports the first table and names the second in the reasons, without importing it', () => {
			const table = tableOf(workbook.analysis, 'Stacked');
			expect(table).toMatchObject({ status: 'ready', headerRows: [1], dataRows: [2, 3, 4] });
			expect(table.range.bottom).toBeLessThan(6);
			expect(sheetOf(workbook.analysis, 'Stacked').reasons.join('\n')).toMatch(/Row 6 starts another table/);
			expect(recordsOf(workbook.analysis, 'Stacked').map((record) => record.sourceRow)).toEqual([2, 3, 4]);
			expect(workbook.analysis.summary.toImport).toBe(3);
		});
	});

	describe('documented gap: a header split over two rows', () => {
		// Design note §11 and OD3: detection only proposes single-row headers. Today row 1 is the header, row 2's
		// "Number" cells read as data, the NSN column is not recognized, and the table is held back with an AI
		// suggestion. If OD3 is built, expect headerRows [1, 2], a ready table, and 4 records instead.
		const workbook = useWorkbook('two-row-header.xlsx', [
			{
				name: 'TwoRow',
				rows: [
					['Part', 'National Stock', 'Item'],
					['Number', 'Number', 'Name'],
					['BRK-1001', NSN[0], 'Screw, machine'],
					['BRK-1002', NSN[1], 'Screw, assembly'],
					['GRD-3001', NSN[2], 'Guard, shock absorber'],
					['CAR-4001', NSN[3], 'Carrier, drive sprocket']
				]
			}
		]);

		it('reads only row 1 as the header and holds the table back for review', () => {
			const sheet = sheetOf(workbook.analysis, 'TwoRow');
			expect(sheet.status).toBe('needs-review');
			expect(sheet.aiTrigger).not.toBeNull();
			const table = tableOf(workbook.analysis, 'TwoRow');
			expect(table.headerRows).toEqual([1]);
			expect(table.dataRows).toEqual(rows(2, 6));
			expect(mappedColumns(table)).toEqual({ part: 'A' });
			const includeId = decisionId('include-table', table.id);
			const include = workbook.analysis.decisions.find((decision) => decision.id === includeId);
			expect(include).toMatchObject({ state: 'pending', suggested: 'exclude' });
			expect(workbook.analysis.summary.toImport).toBe(0);
		});
	});
});
