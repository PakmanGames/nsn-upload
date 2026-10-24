import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetAnalysis, TableCandidate, WorkbookModel } from '../model';
import { readWorkbook } from '../reader';
import { analyzeStructure } from '.';

const PENCOM = 'PENCOM_Government_Procurement_Database (2).xlsx';
const STATZ = 'Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx';
const WOW = 'WOW NSN list 7-20-26 (2).xlsx';

function readFixture(fileName: string): Promise<WorkbookModel> {
	const bytes = readFileSync(resolve('example-excel-uploads', fileName));
	return readWorkbook(new Uint8Array(bytes).buffer, fileName);
}

const [pencom, statz, wow] = (await Promise.all([readFixture(PENCOM), readFixture(STATZ), readFixture(WOW)])).map((model) =>
	analyzeStructure(model, {})
);

const sheetNamed = (sheets: SheetAnalysis[], name: string) => sheets.find((s) => s.name === name)!;
const mapping = (table: TableCandidate) =>
	Object.fromEntries(table.columns.filter((c) => c.field).map((c) => [String.fromCharCode(64 + c.col), c.field]));
const column = (table: TableCandidate, header: string) => table.columns.find((c) => c.header === header)!;

describe('PENCOM fixture', () => {
	it('classifies all six sheets', () => {
		expect(pencom.map((s) => [s.name, s.status])).toEqual([
			['Dashboard', 'no-table'],
			['NSN Cross-Reference', 'ready'],
			['Opportunity Matrix', 'no-table'],
			['Part Number Intake', 'ready'],
			['Search Log', 'needs-review'],
			['Sources & Notes', 'no-table']
		]);
		// The held-back table asks for AI help; dashboards and notes never do (D23).
		expect(pencom.filter((s) => s.aiTrigger).map((s) => s.name)).toEqual(['Search Log']);
	});

	it('finds the headers on row 2 and ignores the styled empty rows', () => {
		const [xref] = sheetNamed(pencom, 'NSN Cross-Reference').tables;
		expect(xref).toMatchObject({ headerRows: [2], dataRows: [3, 4], range: { top: 2, bottom: 4, left: 1, right: 12 } });
		expect(mapping(xref)).toEqual({ A: 'nsn', B: 'fsc', C: 'niin', D: 'description', E: 'part', F: 'cage' });
		expect(column(xref, 'Manufacturer').field).toBeNull();

		const [intake] = sheetNamed(pencom, 'Part Number Intake').tables;
		expect(intake).toMatchObject({ headerRows: [2], dataRows: [3, 4] });
		expect(intake.skippedRows).toEqual([5, 6, 7].map((row) => ({ row, reason: 'no-mapped-values' })));
		expect(mapping(intake)).toEqual({ A: 'part', C: 'description', J: 'nsn', K: 'fsc' });
		expect(column(intake, 'NSN Found').field).toBeNull();
	});

	it('holds back the search log', () => {
		const [log] = sheetNamed(pencom, 'Search Log').tables;
		expect(log.status).toBe('needs-review');
		expect(column(log, 'NSN / Reference')).toMatchObject({ field: 'nsn', confidence: 'medium' });
	});
});

describe('Statz fixture', () => {
	const [sheet] = statz;
	const [table] = sheet.tables;

	it('finds 54 data rows in one logical table', () => {
		expect(sheet.status).toBe('ready');
		expect(table.dataRows).toHaveLength(54);
		expect(table.skippedRows).toEqual([
			{ row: 32, reason: 'blank' },
			{ row: 33, reason: 'blank' },
			{ row: 34, reason: 'repeated-header' }
		]);
	});

	it('maps G & B P/N and NSN, with Dwg Number as an alternative only', () => {
		expect(mapping(table)).toEqual({ A: 'part', C: 'nsn' });
		expect(column(table, 'NSN')).toMatchObject({ confidence: 'high', valuePassRate: 1 });
		expect(column(table, 'Dwg Number')).toMatchObject({ field: null, alternatives: ['part'] });
		expect(column(table, 'Mfg.').field).toBeNull();
		expect(table.reasons).toEqual(expect.arrayContaining(['No Description column found', 'No CAGE column found']));
	});
});

describe('WOW fixture', () => {
	const [table] = sheetNamed(wow, 'Active Parts').tables;

	it('maps Part Number, NSN, and Nomenclature, never the metadata columns', () => {
		expect(sheetNamed(wow, 'Active Parts').status).toBe('ready');
		expect(mapping(table)).toEqual({ D: 'part', E: 'nsn', F: 'description' });
		expect(table.dataRows).toHaveLength(179);
		expect(table.columns.slice(0, 3).map((c) => c.field)).toEqual([null, null, null]);
	});

	it('quotes 127 of 129 valid NSNs', () => {
		expect(column(table, 'NSN').reasons).toEqual(["Header 'NSN' matches NSN", '127 of 129 values are valid NSNs']);
	});

	it('ignores the very hidden sheet', () => {
		expect(sheetNamed(wow, 'hiddenSheet')).toMatchObject({ status: 'hidden', tables: [] });
	});
});
