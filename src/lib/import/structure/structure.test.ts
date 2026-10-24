import { describe, expect, it } from 'vitest';
import type { Field, SheetAnalysis, TableCandidate } from '../model';
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure } from '.';
import { pencomShape, statzShape, wowShape } from './test-shapes';

const analyzeSheets = (...sheets: Parameters<typeof makeSheet>[]) =>
	analyzeStructure(makeWorkbook('test.xlsx', sheets.map((args) => makeSheet(...args))), {});

const byName = (sheets: SheetAnalysis[], name: string) => sheets.find((s) => s.name === name)!;

/** Column letter -> field for mapped columns, e.g. { D: 'part' }. */
function mapping(table: TableCandidate): Record<string, Field> {
	return Object.fromEntries(table.columns.filter((c) => c.field).map((c) => [String.fromCharCode(64 + c.col), c.field!]));
}

describe('PENCOM shape', () => {
	const sheets = analyzeStructure(pencomShape(), {});

	it('classifies every visible sheet', () => {
		expect(sheets.map((s) => [s.name, s.status])).toEqual([
			['Dashboard', 'no-table'],
			['NSN Cross-Reference', 'ready'],
			['Opportunity Matrix', 'no-table'],
			['Part Number Intake', 'ready'],
			['Search Log', 'needs-review'],
			['Sources & Notes', 'no-table']
		]);
		for (const sheet of sheets) expect(sheet.reasons.length).toBeGreaterThan(0);
	});

	it('finds the header on row 2 below a merged title', () => {
		const [table] = byName(sheets, 'NSN Cross-Reference').tables;
		expect(table.id).toBe('NSN Cross-Reference@2');
		expect(table.headerRows).toEqual([2]);
		expect(table.dataRows).toEqual([3, 4]);
		expect(mapping(table)).toEqual({ A: 'nsn', B: 'fsc', C: 'niin', D: 'description', E: 'part', F: 'cage' });
		expect(table.columns.find((c) => c.header === 'Manufacturer')?.field).toBeNull();
	});

	it('skips placeholder rows with values only in unmapped columns', () => {
		const [table] = byName(sheets, 'Part Number Intake').tables;
		expect(table.dataRows).toEqual([3, 4]);
		expect(table.skippedRows).toEqual([5, 6, 7].map((row) => ({ row, reason: 'no-mapped-values' })));
		expect(mapping(table)).toEqual({ A: 'part', C: 'description', G: 'nsn', H: 'fsc' });
		expect(table.reasons).toContain('No CAGE column found');
	});

	it('does not map NSN Found (Yes) or the equivalent-part columns', () => {
		const [table] = byName(sheets, 'Part Number Intake').tables;
		const found = table.columns.find((c) => c.header === 'NSN Found')!;
		expect(found.field).toBeNull();
		expect(found.reasons).toEqual(["Header 'NSN Found' mentions NSN but also says 'found'", '0 of 2 values are valid NSNs']);
	});

	it('holds back the search log with evidence for each mapped column', () => {
		const log = byName(sheets, 'Search Log');
		const [table] = log.tables;
		expect(table.status).toBe('needs-review');
		expect(table.dataRows).toEqual([3, 4, 5]);
		const reference = table.columns.find((c) => c.header === 'NSN / Reference')!;
		expect(reference).toMatchObject({ field: 'nsn', confidence: 'medium', valuePassRate: 2 / 3 });
		expect(reference.reasons).toEqual(["Header 'NSN / Reference' matches NSN", '2 of 3 values are valid NSNs']);
		expect(table.columns.find((c) => c.header === 'Part Number / Family')).toMatchObject({ field: 'part', confidence: 'low' });
		expect(log.aiTrigger).toBeNull();
	});

	it('explains why dashboards and notes have no table', () => {
		expect(byName(sheets, 'Opportunity Matrix').reasons).toEqual([
			'No column holds part numbers, NSNs, or NIINs under a matching header',
			"Row 2, column C: Header 'Likely FSC' matches FSC; 1 of 4 values are valid FSCs",
			"Row 2, column E: Header 'NSN Matchability (1-5)' mentions NSN but also says 'matchability'; 0 of 4 values are valid NSNs"
		]);
		expect(byName(sheets, 'Sources & Notes').reasons).toContain(
			'Row 3 looks like a header, but none of its columns names Part, NSN, or NIIN'
		);
		expect(byName(sheets, 'Dashboard').tables).toEqual([]);
	});
});

describe('Statz shape', () => {
	const [sheet] = analyzeStructure(statzShape(), {});
	const [table] = sheet.tables;

	it('reads both blocks as one table and skips the blank and repeated header rows', () => {
		expect(sheet.status).toBe('ready');
		expect(table.dataRows).toHaveLength(54);
		expect(table.skippedRows).toEqual([
			{ row: 32, reason: 'blank' },
			{ row: 33, reason: 'blank' },
			{ row: 34, reason: 'repeated-header' }
		]);
		expect(table.reasons).toContain('Skipped 2 blank rows (32-33), 1 repeated header row (34)');
	});

	it('maps G & B P/N and NSN, offering Dwg Number only as an alternative part column', () => {
		expect(mapping(table)).toEqual({ A: 'part', C: 'nsn' });
		const drawing = table.columns.find((c) => c.header === 'Dwg Number')!;
		expect(drawing).toMatchObject({ field: null, alternatives: ['part'], confidence: 'low' });
		expect(table.columns.find((c) => c.header === 'NSN')?.alternatives).toEqual([]);
		expect(table.columns.find((c) => c.header === 'Mfg.')).toMatchObject({ field: null, alternatives: [] });
	});

	it('reports missing optional columns once at table level', () => {
		expect(table.reasons).toEqual(expect.arrayContaining(['No Description column found', 'No CAGE column found']));
	});
});

describe('WOW shape', () => {
	const sheets = analyzeStructure(wowShape(), {});
	const [table] = byName(sheets, 'Active Parts').tables;

	it('maps Part Number, NSN, and Nomenclature and never the hidden metadata columns', () => {
		expect(byName(sheets, 'Active Parts').status).toBe('ready');
		expect(mapping(table)).toEqual({ D: 'part', E: 'nsn', F: 'description' });
		expect(table.dataRows).toHaveLength(30);
		for (const col of [1, 2, 3]) {
			expect(table.columns[col - 1]).toMatchObject({ field: null, alternatives: [] });
			expect(table.columns[col - 1].reasons[0]).toMatch(/^Hidden column/);
		}
	});

	it('quotes the NSN pass rate', () => {
		const nsn = table.columns.find((c) => c.field === 'nsn')!;
		expect(nsn).toMatchObject({ confidence: 'high', valuePassRate: 22 / 24 });
		expect(nsn.reasons).toEqual(["Header 'NSN' matches NSN", '22 of 24 values are valid NSNs']);
	});

	it('ignores the very hidden sheet', () => {
		expect(byName(sheets, 'hiddenSheet')).toEqual({
			name: 'hiddenSheet',
			index: 1,
			status: 'hidden',
			reasons: ['Hidden in workbook'],
			tables: [],
			aiTrigger: null
		});
	});

	it('lets Part Number win over a visible (Do Not Modify) Part column of UUIDs', () => {
		const [visible] = analyzeStructure(wowShape({ metadataHidden: false }), {});
		const [t] = visible.tables;
		expect(mapping(t)).toEqual({ D: 'part', E: 'nsn', F: 'description' });
		expect(t.columns[0].reasons).toEqual([
			"Header '(Do Not Modify) Part' mentions Part but also says 'do not modify'",
			'0 of 30 values are plausible part numbers'
		]);
	});
});

describe('header variants', () => {
	it.each(['G & B P/N', 'PENCOM Part Number', 'Part\nNumber', 'P/N', 'Part No.'])('maps %j to part', (header) => {
		const [sheet] = analyzeSheets(['Parts', [[header, 'NSN'], ['457985-1 B', '5305-01-658-2565'], ['10931023*92', '5305 01 658 2566']]]);
		expect(mapping(sheet.tables[0])).toEqual({ A: 'part', B: 'nsn' });
	});

	it('maps a part column whose values start with header vocabulary (PN-4410)', () => {
		const values = ['PN-4410', 'PN-4411', 'PN-4412'];
		const [pair] = analyzeSheets(['Parts', [['Part Number', 'NSN'], ...values.map((v, i) => [v, `5305-01-658-${2565 + i}`])]]);
		expect(mapping(pair.tables[0])).toEqual({ A: 'part', B: 'nsn' });
		expect(pair.tables[0].dataRows).toEqual([2, 3, 4]);

		// With part as the only mapped column, the values must not read as repeated headers either.
		const [single] = analyzeSheets(['Parts', [['Part Number'], ...values.map((v) => [v])]]);
		expect(single.status).toBe('ready');
		expect(single.tables[0]).toMatchObject({ headerRows: [1], dataRows: [2, 3, 4], skippedRows: [] });
	});

	it('maps none of the header traps to NSN or CAGE', () => {
		const [sheet] = analyzeSheets([
			'Traps',
			[
				['Part Number', 'NSN Found', 'NSN Matchability (1-5)', 'Manufacturer', 'Mfg.'],
				['SE5826', 'Yes', 5, 'PENCOM', 'Y'],
				['RC 620', 'No', 3, 'PENCOM', 'N'],
				['UTU44013', 'Yes', 4, 'PENCOM', 'Y']
			]
		]);
		expect(mapping(sheet.tables[0])).toEqual({ A: 'part' });
	});
});

describe('detection rules', () => {
	const nsns = (n: number, from = 0) => Array.from({ length: n }, (_, i) => `5305-01-${100 + from + i}-${2000 + from + i}`);

	it('classifies empty sheets as having no table', () => {
		const [sheet] = analyzeSheets(['Empty', []]);
		expect(sheet).toMatchObject({ status: 'no-table', reasons: ['Sheet has no values'], aiTrigger: null });
	});

	it('maps an NSN column from values alone at medium confidence', () => {
		const [sheet] = analyzeSheets(['Codes', [['Item', 'Stock'], ...nsns(4).map((n, i) => [`Widget ${i}`, n])]]);
		const [table] = sheet.tables;
		expect(mapping(table)).toEqual({ B: 'nsn' });
		expect(table.columns[1].reasons).toEqual(["Header 'Stock' does not name NSN", '4 of 4 values are valid NSNs']);
		expect(sheet.status).toBe('needs-review');
		expect(sheet.aiTrigger).toBe('4 cells look like NSNs or NIINs, but the table needs review');
	});

	it('maps a NIIN column from values even under an NSN header', () => {
		const [sheet] = analyzeSheets(['Parts', [['Part', 'NSN'], ['SE5826', '016582565'], ['RC 620', '016698021'], ['UTU44013', '012345678']]]);
		expect(mapping(sheet.tables[0])).toEqual({ A: 'part', B: 'niin' });
	});

	it('does not map a numeric quantity or row-number column to NIIN from values alone', () => {
		// Small numbers become "valid" NIINs only through restore-leading-zeros, which value-only scoring ignores.
		const [sheet] = analyzeSheets([
			'Parts',
			[['#', 'Part Number', 'Qty'], ...['SE5826', 'RC 620', 'UTU44013', 'NASM21083'].map((part, i) => [i + 1, part, (i + 1) * 25])]
		]);
		const [table] = sheet.tables;
		expect(mapping(table)).toEqual({ B: 'part' });
		expect(table.columns[0]).toMatchObject({ field: null, alternatives: [] });
		expect(table.columns[2]).toMatchObject({ field: null, alternatives: [] });
	});

	it('sets an AI trigger when identifiers appear outside any table', () => {
		// One NSN per column: no column holds enough of them to be a table without a header row.
		const [sheet] = analyzeSheets(['Notes', [['Research notes'], ...nsns(3).map((n, i) => ['Found on the listing', ...Array(i).fill(null), n])]]);
		expect(sheet.status).toBe('no-table');
		expect(sheet.aiTrigger).toBe('3 cells look like NSNs or NIINs, but no table was recognized');
	});

	it('holds back a table whose part column has a rival', () => {
		const [sheet] = analyzeSheets([
			'Parts',
			[['Part Number', 'Vendor P/N', 'NSN'], ...nsns(3).map((n, i) => [`SE58${i}`, `A-${i}00`, n])]
		]);
		expect(sheet.status).toBe('needs-review');
		expect(sheet.aiTrigger).toBe('Columns A and B both look like the Part column');
	});

	it('accepts a one-column list with a single header cell', () => {
		const [sheet] = analyzeSheets(['List', [['NSN'], ...nsns(3).map((n) => [n])]]);
		expect(sheet.status).toBe('ready');
		expect(sheet.tables[0].dataRows).toEqual([2, 3, 4]);
	});

	it('skips hidden rows and does not count error cells against a column', () => {
		const [sheet] = analyzeSheets([
			'Parts',
			[['Part', 'NSN'], ['SE5826', nsns(1)[0]], ['RC 620', { kind: 'error', raw: '#N/A' }], ['HIDDEN-1', 'junk'], ['UTU44013', nsns(1, 1)[0]]],
			{ hiddenRows: [4] }
		]);
		const [table] = sheet.tables;
		expect(table.skippedRows).toEqual([{ row: 4, reason: 'hidden' }]);
		expect(table.columns[1]).toMatchObject({ field: 'nsn', valuePassRate: 1 });
	});

	it('stops at a second, different table and says so', () => {
		const rows: CellInput[][] = [['Part Number', 'NSN'], ['SE5826', nsns(1)[0]], ['RC 620', nsns(1, 1)[0]], [], ['NIIN', 'CAGE'], ['016582565', '0BWZ1']];
		const [sheet] = analyzeSheets(['Stacked', rows]);
		const [table] = sheet.tables;
		expect(table.range).toEqual({ top: 1, left: 1, bottom: 4, right: 2 });
		expect(table.dataRows).toEqual([2, 3]);
		expect(sheet.reasons).toContain(
			'Row 5 starts another table (NIIN, CAGE); only one table per sheet is imported, so rows 5-6 are not'
		);
	});

	it('treats a part-number cell that repeats the header field as a repeated header', () => {
		const rows: CellInput[][] = [['P/N', 'NSN'], ['SE5826', nsns(1)[0]], ['Part No.', 'NSN'], ['RC 620', nsns(1, 1)[0]]];
		const [sheet] = analyzeSheets(['Blocks', rows]);
		expect(sheet.tables[0].skippedRows).toEqual([{ row: 3, reason: 'repeated-header' }]);
	});
});
