import { describe, expect, it } from 'vitest';
import type { Overrides, SheetAnalysis, TableSpec } from '../model';
import { makeSheet, makeWorkbook } from '../testing';
import { analyzeStructure, materializeTable } from '.';
import { pencomShape, statzShape } from './test-shapes';

const sheetNamed = (sheets: SheetAnalysis[], name: string) => sheets.find((s) => s.name === name)!;

describe('column overrides', () => {
	it('recomputes status when the user remaps columns', () => {
		const overrides: Overrides = { columns: { 'Search Log@2': { 2: null, 6: 'nsn' } } };
		const log = sheetNamed(analyzeStructure(pencomShape(), overrides), 'Search Log');
		const [table] = log.tables;

		expect(log.status).toBe('ready');
		expect(table.columns[1]).toMatchObject({ field: null, overridden: true, reasons: ['Excluded by user'] });
		expect(table.columns[5]).toMatchObject({ field: 'nsn', confidence: 'high', overridden: true, valuePassRate: 2 / 3 });
		expect(table.columns[5].reasons[0]).toBe('Set by user');
	});

	it('unmaps the column that had the field when the user gives it to another column', () => {
		const overrides: Overrides = { columns: { 'Sheet1@1': { 2: 'part' } } };
		const [sheet] = analyzeStructure(statzShape(), overrides);
		const [partColumn, drawingColumn] = sheet.tables[0].columns;

		expect(drawingColumn).toMatchObject({ field: 'part', confidence: 'high', overridden: true });
		expect(partColumn).toMatchObject({ field: null, overridden: false, reasons: ['Replaced by user mapping of column B'] });
		expect(sheet.tables[0].dataRows).toHaveLength(54);
	});

	it('recomputes data rows from the new mapping', () => {
		const overrides: Overrides = { columns: { 'Part Number Intake@2': { 5: 'description' } } };
		const intake = sheetNamed(analyzeStructure(pencomShape(), overrides), 'Part Number Intake');

		// The status-only rows now have a mapped value, so they become candidate rows instead of being skipped.
		expect(intake.tables[0].dataRows).toEqual([3, 4, 5, 6, 7]);
		expect(intake.tables[0].skippedRows).toEqual([]);
	});

	it('ignores overrides for other tables', () => {
		const plain = analyzeStructure(statzShape(), {});
		expect(analyzeStructure(statzShape(), { columns: { 'Other@1': { 1: null } } })).toEqual(plain);
	});
});

describe('AI tables', () => {
	// No header row at all: detection finds the table from its NSN values alone, and an AI table still replaces it.
	const notes = makeSheet('Notes', [
		['Screw', '5305-01-658-2565'],
		['Screw, Assembly', '5305-01-669-8021'],
		['Spacer', '5340-01-111-2222']
	]);
	const workbook = makeWorkbook('notes.xlsx', [notes]);
	const spec: TableSpec = { headerRows: [], range: { top: 1, left: 1, bottom: 3, right: 2 }, columns: { 1: 'description', 2: 'nsn' } };

	it('replaces deterministic detection on its sheet and is not offered to the AI again', () => {
		const [before] = analyzeStructure(workbook, {});
		expect(before).toMatchObject({ status: 'needs-review', aiTrigger: null });
		expect(before.tables[0]).toMatchObject({ id: 'Notes@1', headerRows: [], source: 'deterministic' });

		const table = materializeTable(notes, spec, 'ai');
		const [after] = analyzeStructure(workbook, { aiTables: [table] });

		expect(table).toMatchObject({ id: 'Notes@1', dataRows: [1, 2, 3], status: 'needs-review' });
		expect(table.columns[1]).toMatchObject({ field: 'nsn', confidence: 'medium' });
		expect(after).toMatchObject({ status: 'needs-review', aiTrigger: null, tables: [table] });
		expect(after.reasons[0]).toBe('Table proposed by AI and verified against the workbook');
	});

	it('applies user remaps to an AI table with the same rules', () => {
		const table = materializeTable(notes, spec, 'ai');
		const [sheet] = analyzeStructure(workbook, { aiTables: [table], columns: { [table.id]: { 2: 'nsn' } } });

		expect(sheet.tables[0]).toMatchObject({ source: 'ai', status: 'ready' });
		expect(sheet.tables[0].reasons[0]).toBe('Proposed by AI; columns changed by user');
	});
});

describe('materializeTable', () => {
	it('joins two header rows and scores every proposed column on its values', () => {
		const sheet = makeSheet('Parts', [
			['Part', 'Stock', 'Notes'],
			['Number', 'Number', null],
			['SE5826', '5305-01-669-8021', 'ok'],
			['RC 620', 'Pending', 'check'],
			[null, null, 'footer']
		]);
		const table = materializeTable(sheet, { headerRows: [1, 2], range: { top: 1, left: 1, bottom: 5, right: 3 }, columns: { 1: 'part', 2: 'nsn' } }, 'ai');

		expect(table).toMatchObject({ id: 'Parts@1', headerRows: [1, 2], dataRows: [3, 4], source: 'ai', status: 'needs-review' });
		expect(table.skippedRows).toEqual([{ row: 5, reason: 'no-mapped-values' }]);
		expect(table.columns[0]).toMatchObject({ header: 'Part Number', field: 'part', confidence: 'high' });
		expect(table.columns[1]).toMatchObject({ header: 'Stock Number', field: 'nsn', confidence: 'low', valuePassRate: 0.5 });
		expect(table.columns[1].reasons).toEqual(["Header 'Stock Number' does not name NSN", '1 of 2 values are valid NSNs', 'Values alone cannot confirm NSN']);
		expect(table.reasons.at(-1)).toBe("Needs review: NSN column B 'Stock Number' is low confidence");
	});

	it('maps only what the spec says, so automatic rules such as hidden columns are the caller’s concern', () => {
		const sheet = makeSheet('Parts', [['Id', 'Part'], ['b1c35601-c8c9-f011-bbd2-000d3a3bdce8', 'SE5826']], { hiddenCols: [1] });
		const table = materializeTable(sheet, { headerRows: [1], range: { top: 1, left: 1, bottom: 2, right: 2 }, columns: { 2: 'part' } }, 'deterministic');

		expect(table.columns.map((c) => c.field)).toEqual([null, 'part']);
		expect(table.status).toBe('ready');
	});
});

describe('tables set up by hand', () => {
	const nsns = ['5305-01-658-2565', '5305-01-669-8021', '5340-01-102-4535', '3020-01-660-9619'];
	// A header detection does not know ("Item", "Stock"), above part numbers and too few NSNs to map by value.
	const stock = makeSheet('Stock', [['Item', 'Stock', 'Qty'], ['SE5826', nsns[0], 4], ['RC 620', 'pending', 2], ['UTU44013', null, 10]]);
	const list = makeSheet('List', nsns.map((nsn) => [nsn]));
	const workbook = makeWorkbook('stock.xlsx', [stock, list]);
	const manual = (sheet: string, spec: TableSpec): Overrides => ({ manualTables: [{ ...spec, sheet }] });
	const stockSpec: TableSpec = { headerRows: [1], range: { top: 1, left: 1, bottom: 4, right: 3 }, columns: { 1: 'part', 2: 'nsn' } };
	const listSpec: TableSpec = { headerRows: [], range: { top: 1, left: 1, bottom: 4, right: 1 }, columns: { 1: 'nsn' } };

	it('materializes a table with a header row on a sheet where none was found, with the usual rules', () => {
		expect(analyzeStructure(workbook, {})[0]).toMatchObject({ status: 'no-table', tables: [] });

		const [sheet] = analyzeStructure(workbook, manual('Stock', stockSpec));
		const [table] = sheet.tables;
		expect(sheet).toMatchObject({ status: 'needs-review', aiTrigger: null });
		expect(sheet.reasons[0]).toBe('Table set up by you');
		expect(table).toMatchObject({ id: 'Stock@1', source: 'user', headerRows: [1], dataRows: [2, 3, 4] });
		// Confidence still comes from the header and the values: neither "Item" nor "Stock" names its field.
		expect(table.columns[1]).toMatchObject({ field: 'nsn', confidence: 'low', overridden: false });
		expect(table.columns[1].reasons).toContain('1 of 2 values are valid NSNs');
		expect(table.columns[2]).toMatchObject({ field: null });
	});

	it('materializes a table without a header row under the id of its first data row', () => {
		const [, sheet] = analyzeStructure(workbook, manual('List', listSpec));
		expect(sheet.tables[0]).toMatchObject({ id: 'List@1', source: 'user', headerRows: [], dataRows: [1, 2, 3, 4] });
		expect(sheet.tables[0].columns[0]).toMatchObject({ field: 'nsn', confidence: 'medium' });
	});

	it('applies the user’s later column changes to it', () => {
		const overrides: Overrides = { ...manual('Stock', stockSpec), columns: { 'Stock@1': { 2: null } } };
		const [table] = analyzeStructure(workbook, overrides)[0].tables;
		expect(table.columns[1]).toMatchObject({ field: null, overridden: true, reasons: ['Excluded by user'] });
		expect(table.columns[0].field).toBe('part');
	});

	it('wins over an AI table on the same sheet', () => {
		const ai = materializeTable(list, { ...listSpec, columns: { 1: 'niin' } }, 'ai');
		const [, sheet] = analyzeStructure(workbook, { aiTables: [ai], ...manual('List', listSpec) });
		expect(sheet.tables).toHaveLength(1);
		expect(sheet.tables[0]).toMatchObject({ source: 'user', columns: [expect.objectContaining({ field: 'nsn' })] });
	});

	it('gives the sheet back to detection once removed', () => {
		const detected = analyzeStructure(workbook, {});
		expect(analyzeStructure(workbook, { manualTables: [] })).toEqual(detected);
		expect(detected[1].tables[0]).toMatchObject({ id: 'List@1', source: 'deterministic' });
	});
});
