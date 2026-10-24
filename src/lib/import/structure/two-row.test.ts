import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook, type SheetOptions } from '../testing';
import { analyzeStructure } from '.';

/** Four consistent data rows: part, NSN, its NIIN, description, CAGE. */
const DATA: CellInput[][] = [
	['BRK-1001', '5305-01-658-2565', '016582565', 'Screw, machine', '0BWZ1'],
	['BRK-1002', '5305-01-669-8021', '016698021', 'Screw, assembly', '0BWZ1'],
	['GRD-3001', '5340-01-111-2222', '011112222', 'Guard, shock absorber', '1ABC2'],
	['CAR-4001', '3020-00-722-3633', '007223633', 'Carrier, drive sprocket', '1ABC2']
];

function run(rows: CellInput[][], options?: SheetOptions) {
	const workbook = makeWorkbook('two-row.xlsx', [makeSheet('Parts', rows, options)]);
	const [sheet] = analyzeStructure(workbook, {});
	const records = analyze(workbook, []).records;
	return { sheet, table: sheet.tables[0], records };
}

/** Field -> column letter for mapped columns. */
function mapped(table: { columns: Array<{ col: number; field: string | null }> }): Record<string, string> {
	return Object.fromEntries(table.columns.filter((c) => c.field).map((c) => [c.field!, String.fromCharCode(64 + c.col)]));
}

const parts = (records: Array<{ fields: { part?: { value: string } } }>) => records.map((r) => r.fields.part?.value);

describe('two-row headers', () => {
	it('A: joins Part/Number, National Stock/Number, Item/Name, CAGE/Code', () => {
		const { sheet, table, records } = run([
			['Part', 'National Stock', 'NIIN', 'Item', 'CAGE'],
			['Number', 'Number', null, 'Name', 'Code'],
			...DATA
		]);

		expect(sheet.status).toBe('ready');
		expect(table.headerRows).toEqual([1, 2]);
		expect(mapped(table)).toEqual({ part: 'A', nsn: 'B', niin: 'C', description: 'D', cage: 'E' });
		expect(table.columns.map((c) => c.header)).toEqual(['Part Number', 'National Stock Number', 'NIIN', 'Item Name', 'CAGE Code']);
		expect(table.dataRows).toEqual([3, 4, 5, 6]);
		expect(table.reasons[0]).toBe('Header on rows 1-2 (two-row header); table A1:E6');
		expect(parts(records)).toEqual(['BRK-1001', 'BRK-1002', 'GRD-3001', 'CAR-4001']);
	});

	it('B: keeps a full header on row 2 under merged group labels', () => {
		const { sheet, table } = run(
			[['Identifiers', null, null, 'Details'], ['Part Number', 'NSN', 'NIIN', 'Item Name', 'CAGE Code'], ...DATA],
			{ merges: ['A1:C1', 'D1:E1'] }
		);

		expect(sheet.status).toBe('ready');
		expect(table.headerRows).toEqual([2]);
		expect(mapped(table)).toEqual({ part: 'A', nsn: 'B', niin: 'C', description: 'D', cage: 'E' });
		expect(table.dataRows).toEqual([3, 4, 5, 6]);
	});

	it('C: treats a row of bracketed hints as part of the header and matches on row 1', () => {
		const { sheet, table, records } = run([
			['Part Number', 'NSN', 'NIIN', 'Description', 'CAGE'],
			['(mfr ref)', '(13 digits)', '(9 digits)', '(text)', '(5 chars)'],
			...DATA
		]);

		expect(sheet.status).toBe('ready');
		expect(table.headerRows).toEqual([1, 2]);
		expect(mapped(table)).toEqual({ part: 'A', nsn: 'B', niin: 'C', description: 'D', cage: 'E' });
		expect(table.columns.map((c) => c.confidence)).toEqual(['high', 'high', 'high', 'high', 'high']);
		expect(table.columns[1].reasons).toEqual(["Header 'NSN (13 digits)' matches NSN", '4 of 4 values are valid NSNs']);
		expect(records).toHaveLength(4);
	});

	it('D: maps Part/No., Item/Name, NIIN and CAGE from headers and Stock/No. from its values', () => {
		const { sheet, table, records } = run([
			['Part', 'Stock', 'NIIN', 'Item', 'CAGE'],
			['No.', 'No.', null, 'Name', '-'],
			...DATA
		]);

		expect(sheet.status).toBe('ready');
		expect(table.headerRows).toEqual([1, 2]);
		expect(mapped(table)).toEqual({ part: 'A', nsn: 'B', niin: 'C', description: 'D', cage: 'E' });
		expect(table.columns[1]).toMatchObject({ header: 'Stock No.', confidence: 'medium' });
		expect(table.columns[1].reasons[0]).toBe("Header 'Stock No.' does not name NSN");
		expect(table.columns[3].header).toBe('Item Name');
		expect(table.columns[4].header).toBe('CAGE');
		expect(parts(records)).not.toContain('No.');
		expect(records).toHaveLength(4);
	});

	it('E: never takes a data row with a plain-text part next to a valid NSN as a header row', () => {
		const { table, records } = run([
			['Part Number', 'NSN', 'Description'],
			['ABC', '5305-01-111-3333', 'Screw'],
			...DATA.map(([part, nsn, , description]) => [part, nsn, description])
		]);

		expect(table.headerRows).toEqual([1]);
		expect(table.dataRows).toEqual([2, 3, 4, 5, 6]);
		expect(parts(records)).toContain('ABC');
	});

	it('E: does not take a row of other plain text as a header row either', () => {
		const { table } = run([['Part Number', 'Description'], ['ABC', 'Screw'], ...DATA.map(([part, , , description]) => [part, description])]);

		expect(table.headerRows).toEqual([1]);
		expect(table.dataRows).toEqual([2, 3, 4, 5, 6]);
	});

	it('F: skips both rows of a two-row header repeated mid-sheet', () => {
		const header: CellInput[][] = [
			['Part', 'National Stock', 'NIIN', 'Item', 'CAGE'],
			['Number', 'Number', null, 'Name', 'Code']
		];
		const { table, records } = run([...header, DATA[0], DATA[1], ...header, DATA[2], DATA[3]]);

		expect(table.headerRows).toEqual([1, 2]);
		expect(table.skippedRows).toEqual([
			{ row: 5, reason: 'repeated-header' },
			{ row: 6, reason: 'repeated-header' }
		]);
		expect(table.dataRows).toEqual([3, 4, 7, 8]);
		expect(records).toHaveLength(4);
	});
});

describe('repeated header candidates', () => {
	it('keeps the first of two identical headers even when the first block has a malformed value', () => {
		const { table } = run([
			['Part Number', 'NSN'],
			['BRK-1001', '5305-01-658-2565'],
			['BRK-1002', '5305-01-669-8021'],
			['GRD-3001', '5340-01-111-2222'],
			['HUB-6001', '12663107'],
			[],
			['Part Number', 'NSN'],
			['CAR-4001', '3020-00-722-3633'],
			['HUB-5001', '5340-00-235-4398']
		]);

		expect(table.headerRows).toEqual([1]);
		expect(table.dataRows).toEqual([2, 3, 4, 5, 8, 9]);
		expect(table.skippedRows).toEqual([
			{ row: 6, reason: 'blank' },
			{ row: 7, reason: 'repeated-header' }
		]);
	});
});

describe('footer rows', () => {
	it('skips a trailing totals row as a footer and leaves it out of the pass rates', () => {
		const { table, records } = run([
			['Part Number', 'NSN', 'Description', 'Qty'],
			...DATA.map(([part, nsn, , description], i) => [part, nsn, description, i + 1]),
			['Total', null, null, { kind: 'number', text: '10', raw: 10, formula: 'SUM(D2:D5)' }]
		]);

		expect(table.skippedRows).toEqual([{ row: 6, reason: 'footer' }]);
		expect(table.dataRows).toEqual([2, 3, 4, 5]);
		expect(table.columns[0]).toMatchObject({ field: 'part', confidence: 'high', valuePassRate: 1 });
		expect(table.reasons).toContain('Skipped 1 footer row (6)');
		expect(records).toHaveLength(4);
	});

	it('keeps a last row that has an identifier as data even when its part says Total', () => {
		const { table } = run([['Part Number', 'NSN'], ...DATA.map(([part, nsn]) => [part, nsn]), ['Total', '5305-01-111-3333']]);

		expect(table.dataRows).toEqual([2, 3, 4, 5, 6]);
		expect(table.skippedRows).toEqual([]);
	});
});
