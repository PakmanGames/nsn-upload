import { describe, expect, it } from 'vitest';
import { analyze } from '../analyze';
import type { Field, Overrides, SheetAnalysis, TableCandidate } from '../model';
import { colLetter, rangeToA1 } from '../refs';
import type { CellInput } from '../testing';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure } from '.';
import { MAX_TABLES } from './detect';
import { statzShape } from './test-shapes';

const nsn = (i: number) => `5305-01-${String(100 + i).padStart(3, '0')}-${String(2000 + i)}`;
const niin = (i: number) => `01${String(i).padStart(7, '0')}`;

function sheetOf(rows: CellInput[][], overrides: Overrides = {}): SheetAnalysis {
	const [sheet] = analyzeStructure(makeWorkbook('tables.xlsx', [makeSheet('Parts', rows)]), overrides);
	return sheet;
}

/** Column letter -> field for mapped columns, e.g. { E: 'part' }. */
function mapping(table: TableCandidate): Record<string, Field> {
	return Object.fromEntries(table.columns.filter((c) => c.field).map((c) => [colLetter(c.col), c.field!]));
}

/** `n` rows of part, NSN, and description starting at column `left` (1-based), numbered from `from`. */
function block(n: number, left: number, from = 0): CellInput[][] {
	return Array.from({ length: n }, (_, i) => [
		...Array<CellInput>(left - 1).fill(null),
		`BRK-${1000 + from + i}`,
		nsn(from + i),
		`Screw ${from + i}`
	]);
}

const shifted = (left: number, cells: CellInput[]): CellInput[] => [...Array<CellInput>(left - 1).fill(null), ...cells];

describe('several tables on one sheet', () => {
	it('reads two tables stacked at the same columns, each with its own range and rows', () => {
		const sheet = sheetOf([
			['Part Number', 'NSN', 'Description'],
			...block(3, 1),
			[],
			['NIIN', 'Item Name', 'CAGE Code'],
			['016609619', 'Carrier, drive sprocket', '1ABC2'],
			['009673346', 'Hub assembly, wheel', '1ABC2']
		]);
		expect(sheet.status).toBe('ready');
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range), t.status])).toEqual([
			['Parts@1', 'A1:C4', 'ready'],
			['Parts@6', 'A6:C8', 'ready']
		]);
		expect(mapping(sheet.tables[0])).toEqual({ A: 'part', B: 'nsn', C: 'description' });
		expect(mapping(sheet.tables[1])).toEqual({ A: 'niin', B: 'description', C: 'cage' });
		expect(sheet.tables.map((t) => t.dataRows)).toEqual([[2, 3, 4], [7, 8]]);
	});

	it('finds a table shifted right whose labels repeat the first header in other columns', () => {
		// Same labels in the same columns would be a repeated header; four columns over, it is another table.
		const header = ['Part Number', 'NSN', 'Description'];
		const sheet = sheetOf([header, ...block(4, 1), [], [], shifted(5, header), ...block(5, 5, 10)]);
		expect(sheet.tables.map((t) => [rangeToA1(t.range), mapping(t)])).toEqual([
			['A1:C5', { A: 'part', B: 'nsn', C: 'description' }],
			['E8:G13', { E: 'part', F: 'nsn', G: 'description' }]
		]);
		expect(sheet.tables[0].skippedRows).toEqual([]);
		expect(sheet.tables[1].dataRows).toEqual([9, 10, 11, 12, 13]);
		expect(sheet.reasons).toContain('Row 8 starts another table (Part, NSN, Description), so this table ends at row 5');
	});

	it('finds a table shifted left over the first table, without reading its rows into the first', () => {
		// The second table's Mfg. and Type columns sit under the first table's part and NSN columns. Read through,
		// their Y and S values would sink the first table's part column below the mapping threshold.
		const lower = Array.from({ length: 6 }, (_, i): CellInput[] => [`CAR-${4000 + i}`, nsn(20 + i), 'Y', 'S']);
		const sheet = sheetOf([
			shifted(3, ['Part Number', 'NSN', 'Description']),
			...block(3, 3),
			[],
			['P/N', 'National Stock Number', 'Mfg.', 'Type'],
			...lower
		]);
		const [first, second] = sheet.tables;
		expect(rangeToA1(first.range)).toBe('C1:E4');
		expect(mapping(first)).toEqual({ C: 'part', D: 'nsn', E: 'description' });
		expect(first.columns.filter((c) => c.field).map((c) => c.confidence)).toEqual(['high', 'high', 'high']);
		expect(rangeToA1(second.range)).toBe('A6:D12');
		expect(mapping(second)).toEqual({ A: 'part', B: 'nsn' });
	});

	it('reads three stacked tables in row order', () => {
		const sheet = sheetOf([
			['Part Number', 'NSN', 'Description'],
			...block(2, 1),
			[],
			['NIIN', 'CAGE Code'],
			[niin(1), '1ABC2'],
			[niin(2), '2DEF3'],
			[],
			['P/N', 'National Stock Number', 'Item Name'],
			...block(2, 1, 50)
		]);
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range)])).toEqual([
			['Parts@1', 'A1:C3'],
			['Parts@5', 'A5:B7'],
			['Parts@9', 'A9:C11']
		]);
	});

	it('keeps a short table above a longer one, which would otherwise win the header', () => {
		const sheet = sheetOf([
			['Part Number', 'NSN'],
			['SE5826', nsn(1)],
			['RC 620', nsn(2)],
			[],
			['NIIN', 'Item Name', 'CAGE Code'],
			...Array.from({ length: 8 }, (_, i): CellInput[] => [niin(i), `Item ${i}`, '1ABC2'])
		]);
		expect(sheet.tables.map((t) => [t.id, t.dataRows.length])).toEqual([
			['Parts@1', 2],
			['Parts@5', 8]
		]);
		expect(sheet.reasons.join('\n')).not.toMatch(/rows above \d+ are not imported/);
	});

	it('reads a list of NSNs without a header above a table as a table of its own', () => {
		const sheet = sheetOf([
			...Array.from({ length: 5 }, (_, i): CellInput[] => [nsn(i)]),
			[],
			shifted(3, ['Part Number', 'NSN']),
			...Array.from({ length: 4 }, (_, i) => shifted(3, [`BRK-${i}`, nsn(20 + i)]))
		]);
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range), t.headerRows, mapping(t)])).toEqual([
			['Parts@1', 'A1:A5', [], { A: 'nsn' }],
			['Parts@7', 'C7:D11', [7], { C: 'part', D: 'nsn' }]
		]);
		expect(sheet.tables[0].reasons).toContain('Row 7 starts another table, so this table ends at row 5');
		expect(sheet).toMatchObject({ status: 'ready', aiTrigger: null });
	});

	it('does not start a table at a header whose primary column is not high confidence', () => {
		const sheet = sheetOf([['Part Number', 'NSN'], ...block(3, 1).map((r) => r.slice(0, 2)), [], ['NIIN', 'CAGE'], ['12345', 'X'], ['pending', 'X']]);
		expect(sheet.tables).toHaveLength(1);
		expect(sheet.tables[0].range).toMatchObject({ top: 1, bottom: 8 });
	});

	it('keeps a repeated header of the same table as a skipped row (Statz row 34)', () => {
		const [sheet] = analyzeStructure(statzShape(), {});
		expect(sheet.tables).toHaveLength(1);
		expect(sheet.tables[0].skippedRows).toContainEqual({ row: 34, reason: 'repeated-header' });
	});

	it(`reads at most ${MAX_TABLES} tables and says which rows are left`, () => {
		// Alternating headers, so no table repeats the header of the one above it.
		const headers = [['Part Number', 'NSN'], ['NIIN', 'CAGE Code']];
		const rows: CellInput[][] = [];
		for (let i = 0; i <= MAX_TABLES; i++) {
			rows.push(headers[i % 2], i % 2 ? [niin(i), '1ABC2'] : [`BRK-${i}`, nsn(i)], []);
		}
		const sheet = sheetOf(rows);
		expect(sheet.tables).toHaveLength(MAX_TABLES);
		const last = 3 * MAX_TABLES + 1;
		expect(sheet.tables.at(-1)!.reasons).toContain(
			`At most ${MAX_TABLES} tables per sheet are read, so rows ${last}-${last + 1} are not imported`
		);
	});

	it('treats the same fields in the same columns as one table repeating its header', () => {
		const sheet = sheetOf([['Part Number', 'NSN', 'Description'], ...block(3, 1), [], ['P/N', 'NSN', 'Item Name'], ...block(3, 1, 10)]);
		expect(sheet.tables).toHaveLength(1);
		expect(sheet.tables[0].skippedRows).toEqual([
			{ row: 5, reason: 'blank' },
			{ row: 6, reason: 'repeated-header' }
		]);
	});

	it('applies a remap to its own table only', () => {
		const header = ['Part Number', 'NSN', 'Description'];
		const rows = [header, ...block(3, 1), [], shifted(5, header), ...block(3, 5, 10)];
		const sheet = sheetOf(rows, { columns: { 'Parts@6': { 7: null } } });
		expect(mapping(sheet.tables[0])).toEqual({ A: 'part', B: 'nsn', C: 'description' });
		expect(mapping(sheet.tables[1])).toEqual({ E: 'part', F: 'nsn' });
		expect(sheet.tables[1].columns[2]).toMatchObject({ col: 7, field: null, overridden: true });
	});

	it('is ready when one of its tables is, and then offers no AI help', () => {
		// Half the lower table's NSNs are malformed, so its NSN column is low confidence and it needs review.
		const sheet = sheetOf([
			['Part Number', 'NSN'],
			...block(3, 1).map((r) => r.slice(0, 2)),
			[],
			shifted(4, ['Part Number', 'NSN']),
			shifted(4, ['BRK-4001', nsn(41)]),
			shifted(4, ['BRK-4002', '12345']),
			shifted(4, ['BRK-4003', nsn(43)]),
			shifted(4, ['BRK-4004', '67890'])
		]);
		expect(sheet.tables.map((t) => [rangeToA1(t.range), t.status])).toEqual([
			['A1:B4', 'ready'],
			['D6:E10', 'needs-review']
		]);
		expect(sheet).toMatchObject({ status: 'ready', aiTrigger: null });
	});
});

describe('duplicates between two tables on one sheet', () => {
	const rows: CellInput[][] = [
		['Part Number', 'NSN', 'Description'],
		['BRK-1001', nsn(1), 'Screw, machine'],
		['BRK-1002', nsn(2), 'Screw, assembly'],
		[],
		shifted(5, ['P/N', 'National Stock Number', 'Item Name']),
		shifted(5, ['BRK-1001', nsn(1), null]),
		shifted(5, ['BRK-1002', nsn(2), 'Assembly screw'])
	];
	const analysis = analyze(makeWorkbook('dupes.xlsx', [makeSheet('Parts', rows)]), []);

	it('merges compatible records like a duplicate across sheets, naming each table', () => {
		const merge = analysis.decisions.find((d) => d.kind === 'merge-duplicates')!;
		expect(merge.reason).toBe(
			'Parts row 2 of the table at A1:C3 and Parts row 6 of the table at E5:G7 describe the same part BRK-1001 and NSN 5305011012001, and their other fields agree or are missing on one side.'
		);
		const copy = analysis.records.find((r) => r.sourceRow === 6)!;
		expect(copy.issues).toContainEqual(expect.objectContaining({ code: 'duplicate-across-sheets' }));
	});

	it('holds a conflict for the user, with an option per table', () => {
		const conflict = analysis.decisions.find((d) => d.kind === 'resolve-conflict')!;
		expect(conflict.state).toBe('pending');
		expect(conflict.options.slice(0, 2).map((o) => o.label)).toEqual([
			'Use Parts row 3 of the table at A1:C3',
			'Use Parts row 7 of the table at E5:G7'
		]);
	});
});

describe('tables side by side on one sheet', () => {
	/** Two blocks of `n` rows next to each other, the right one starting at column `left`. */
	const beside = (header: CellInput[], right: CellInput[], n: number, left: number): CellInput[][] => [
		[...header, ...Array<CellInput>(left - 1 - header.length).fill(null), ...right],
		...block(n, 1).map((row, i) => [...row, ...block(n, left, 50)[i].slice(row.length)])
	];

	it('reads two tables that share rows as two tables, each id naming its first column', () => {
		const header = ['Part Number', 'NSN', 'Description'];
		const sheet = sheetOf(beside(header, header, 39, 6));
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range), t.status, mapping(t)])).toEqual([
			['Parts@1:A', 'A1:C40', 'ready', { A: 'part', B: 'nsn', C: 'description' }],
			['Parts@1:F', 'F1:H40', 'ready', { F: 'part', G: 'nsn', H: 'description' }]
		]);
		const workbook = makeWorkbook('beside.xlsx', [makeSheet('Parts', beside(header, header, 39, 6))]);
		expect(analyze(workbook, []).records.filter((r) => r.status === 'valid')).toHaveLength(78);
	});

	it('keeps a notes column beside a table as part of that table, with the id it had', () => {
		const rows = beside(['Part Number', 'NSN', 'Description'], ['Notes'], 5, 5).map((row, i) =>
			i === 0 ? row : [...row.slice(0, 3), null, `Checked ${i}`]
		);
		const sheet = sheetOf(rows);
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range)])).toEqual([['Parts@1', 'A1:E6']]);
	});

	it('finds a table stacked under only one of two side-by-side tables', () => {
		const rows: CellInput[][] = [
			['Part Number', 'NSN', 'Description', null, 'Part Number', 'NSN', 'Description'],
			...block(6, 1).map((row, i) => (i < 3 ? [...row, null, ...block(3, 1, 20)[i]] : row)),
			[null, null, null, null, 'NIIN', 'Item Name', 'CAGE Code'],
			[null, null, null, null, niin(1), 'Carrier, drive sprocket', '1ABC2'],
			[null, null, null, null, niin(2), 'Hub assembly, wheel', '1ABC2']
		];
		const sheet = sheetOf(rows);
		expect(sheet.tables.map((t) => [t.id, rangeToA1(t.range)])).toEqual([
			['Parts@1:A', 'A1:C7'],
			['Parts@1:E', 'E1:G4'],
			['Parts@8', 'E8:G10']
		]);
	});

	it('keeps plain ids when side-by-side tables start on different rows', () => {
		const rows: CellInput[][] = [
			['Part Number', 'NSN', 'Description'],
			['BRK-1000', nsn(0), 'Screw 0', null, 'NIIN', 'CAGE Code'],
			...block(4, 1, 1).map((row, i) => [...row, null, niin(10 + i), '1ABC2'])
		];
		expect(sheetOf(rows).tables.map((t) => [t.id, rangeToA1(t.range)])).toEqual([
			['Parts@1', 'A1:C6'],
			['Parts@2', 'E2:F6']
		]);
	});

	it('does not split a table at a hidden blank column', () => {
		const header = ['Part Number', 'NSN', 'Description'];
		const [sheet] = analyzeStructure(
			makeWorkbook('hidden.xlsx', [makeSheet('Parts', beside(header, header, 5, 5), { hiddenCols: [4] })]),
			{}
		);
		expect(sheet.tables.map((t) => t.id)).toEqual(['Parts@1']);
	});
});
