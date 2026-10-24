import { describe, expect, it } from 'vitest';
import type { CellInput, SheetOptions } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure } from '.';

const nsns = (n: number) => Array.from({ length: n }, (_, i) => `5305-01-${String(100 + i).padStart(3, '0')}-${2000 + i}`);

function analyzeOne(rows: CellInput[][], options?: SheetOptions) {
	const [sheet] = analyzeStructure(makeWorkbook('list.xlsx', [makeSheet('List', rows, options)]), {});
	return sheet;
}

/** Column letter -> field for mapped columns. */
const mapping = (sheet: ReturnType<typeof analyzeOne>) =>
	Object.fromEntries(sheet.tables[0].columns.filter((c) => c.field).map((c) => [String.fromCharCode(64 + c.col), c.field]));

describe('tables without a header row', () => {
	it('finds one column of NSNs from its values and holds it for review', () => {
		const sheet = analyzeOne(nsns(5).map((nsn) => [nsn]));
		const [table] = sheet.tables;

		expect(table).toMatchObject({
			id: 'List@1',
			headerRows: [],
			range: { top: 1, left: 1, bottom: 5, right: 1 },
			dataRows: [1, 2, 3, 4, 5],
			status: 'needs-review',
			confidence: 'medium',
			source: 'deterministic'
		});
		expect(table.columns).toEqual([
			expect.objectContaining({ col: 1, header: '', field: 'nsn', confidence: 'medium', reasons: ['No header text', '5 of 5 values are valid NSNs'] })
		]);
		// The values already decided the table, so there is nothing left for the AI.
		expect(sheet).toMatchObject({ status: 'needs-review', aiTrigger: null });
		expect(sheet.reasons[0]).toBe('Table A1:A5 without a header row: 5 data rows (rows 1-5)');
	});

	it('maps a NIIN column the same way', () => {
		const sheet = analyzeOne(['016582565', '016698021', '011022233'].map((niin) => [niin]));
		expect(mapping(sheet)).toEqual({ A: 'niin' });
	});

	it('maps a column of part numbers beside the NSNs from its values alone, at medium confidence (E4)', () => {
		const sheet = analyzeOne(nsns(4).map((nsn, i) => [nsn, `SE58${i}6-A`]));
		const [table] = sheet.tables;

		expect(mapping(sheet)).toEqual({ A: 'nsn', B: 'part' });
		expect(table.range).toEqual({ top: 1, left: 1, bottom: 4, right: 2 });
		expect(table.columns[1]).toMatchObject({ field: 'part', confidence: 'medium' });
	});

	it('does not make a table of two NSNs', () => {
		const sheet = analyzeOne(nsns(2).map((nsn) => [nsn]));
		expect(sheet).toMatchObject({ status: 'no-table', tables: [] });
		expect(sheet.reasons).toEqual(['No header row found: no row near the top has at least two short text labels']);
	});

	it('does not make a table of a column where too many values are not NSNs', () => {
		const sheet = analyzeOne([...nsns(9).map((nsn) => [nsn]), ['pending']]);
		expect(sheet.status).toBe('no-table');
	});

	it('starts below a title, which is not imported', () => {
		const sheet = analyzeOne([['Stock numbers to quote', null, null], ...nsns(4).map((nsn) => [nsn])], { merges: ['A1:C1'] });
		const [table] = sheet.tables;

		expect(table).toMatchObject({ id: 'List@2', headerRows: [], dataRows: [2, 3, 4, 5] });
		// The merged title is wider than the list; the table spans only the columns with values below it.
		expect(table.range).toEqual({ top: 2, left: 1, bottom: 5, right: 1 });
		expect(sheet.reasons).toContain('Row 1 above the first NSN or NIIN is not imported');
	});

	it('reads a first row of identifiers as data even when most of its cells look like labels', () => {
		// NSN, part, description, CAGE: three of four cells in row 1 are short text, so it would pass for a header.
		const rows = nsns(4).map((nsn, i) => [nsn, `SE58${i}6-A`, 'Screw, machine', '0BWZ1']);
		const sheet = analyzeOne(rows);

		expect(sheet.tables[0]).toMatchObject({ id: 'List@1', headerRows: [], dataRows: [1, 2, 3, 4] });
		expect(mapping(sheet)).toEqual({ A: 'nsn', B: 'part' });
	});

	it('keeps using a real header row when there is one', () => {
		const sheet = analyzeOne([['NSN'], ...nsns(4).map((nsn) => [nsn])]);
		expect(sheet.tables[0]).toMatchObject({ id: 'List@1', headerRows: [1], dataRows: [2, 3, 4, 5] });
	});

	it('keeps a header row that names nothing as no table when no column holds identifiers', () => {
		// A summary sheet: supplier counts and dollar amounts.
		const sheet = analyzeOne([
			['Supplier', 'Matches', 'Est. Value'],
			['Acme Corp', 12, '$1,204.50'],
			['Globex', 7, '$310.00'],
			['Initech', 3, '$88.20']
		]);
		expect(sheet).toMatchObject({ status: 'no-table', tables: [], aiTrigger: null });
	});
});
