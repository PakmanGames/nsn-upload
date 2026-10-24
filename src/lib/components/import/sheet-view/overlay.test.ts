import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import { decisionId, type WorkbookModel } from '$lib/import/model';
import { readWorkbook } from '$lib/import/reader';
import { buildOverlay, tableAt } from './overlay';

const PENCOM = 'PENCOM_Government_Procurement_Database (2).xlsx';
const STATZ = 'Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx';
const WOW = 'WOW NSN list 7-20-26 (2).xlsx';

function readFixture(fileName: string): Promise<WorkbookModel> {
	const bytes = readFileSync(resolve('example-excel-uploads', fileName));
	return readWorkbook(new Uint8Array(bytes).buffer, fileName);
}

const [pencom, statz, wow] = await Promise.all([readFixture(PENCOM), readFixture(STATZ), readFixture(WOW)]);

describe('buildOverlay', () => {
	it('outlines WOW\'s table and puts a chip on each mapped column', () => {
		const overlay = buildOverlay(analyze(wow, [], {})).get('Active Parts')!;
		expect(overlay.tables).toHaveLength(1);
		const [table] = overlay.tables;
		expect(table).toMatchObject({ id: 'Active Parts@1', range: { top: 1, left: 1, bottom: 180, right: 6 }, tone: 'included' });
		expect([...table.headerRows]).toEqual([1]);
		expect(Object.fromEntries(overlay.chips)).toEqual({
			4: [{ field: 'part', tone: 'included' }],
			5: [{ field: 'nsn', tone: 'included' }],
			6: [{ field: 'description', tone: 'included' }]
		});
	});

	it('maps each data row to its first record, so a split row opens its first value', () => {
		const [table] = buildOverlay(analyze(wow, [], {})).get('Active Parts')!.tables;
		expect(table.records.get(2)).toBe('Active Parts@1:r2');
		// D136 holds two part numbers, split into records .1 and .2.
		expect(table.records.get(136)).toBe('Active Parts@1:r136.1');
		expect(table.records.has(1)).toBe(false);
	});

	it('dims Statz\'s blank rows and repeated header with their reasons', () => {
		const [table] = buildOverlay(analyze(statz, [], {})).get('Sheet1')!.tables;
		expect(Object.fromEntries(table.skipped)).toEqual({ 32: 'blank', 33: 'blank', 34: 'repeated-header' });
		expect(table.records.has(34)).toBe(false);
	});

	it('tones a table by its include decision: included, pending, then excluded once decided', () => {
		const before = buildOverlay(analyze(pencom, [], {}));
		expect(before.get('NSN Cross-Reference')!.tables[0].tone).toBe('included');
		expect(before.get('Search Log')!.tables[0].tone).toBe('pending');
		expect(before.get('Search Log')!.chips.get(6)).toEqual([{ field: 'nsn', tone: 'pending' }]);

		const decisions = { [decisionId('include-table', 'Search Log@2')]: 'exclude' };
		const after = buildOverlay(analyze(pencom, [], { decisions }));
		expect(after.get('Search Log')!.tables[0].tone).toBe('excluded');

		const included = buildOverlay(analyze(pencom, [], { decisions: { [decisionId('include-table', 'Search Log@2')]: 'include' } }));
		expect(included.get('Search Log')!.tables[0].tone).toBe('included');
	});

	it('gives sheets without a table an empty overlay, and finds the table under a cell', () => {
		const overlays = buildOverlay(analyze(pencom, [], {}));
		expect(overlays.get('Dashboard')).toEqual({ tables: [], chips: new Map() });

		const intake = overlays.get('Part Number Intake')!;
		// Rows 5-7 have values only in unmapped columns.
		expect(Object.fromEntries(intake.tables[0].skipped)).toEqual({ 5: 'no-mapped-values', 6: 'no-mapped-values', 7: 'no-mapped-values' });
		expect(tableAt(intake, 3, 1)?.id).toBe('Part Number Intake@2');
		// Row 1 is the merged title above the table.
		expect(tableAt(intake, 1, 1)).toBeUndefined();
	});
});
