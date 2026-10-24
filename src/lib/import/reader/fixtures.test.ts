import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { SheetModel, WorkbookModel } from '../model';
import { rangeToA1 } from '../refs';
import { readWorkbook } from '.';

const PENCOM = 'PENCOM_Government_Procurement_Database (2).xlsx';
const STATZ = 'Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx';
const WOW = 'WOW NSN list 7-20-26 (2).xlsx';

function readFixture(fileName: string): Promise<WorkbookModel> {
	const bytes = readFileSync(resolve('example-excel-uploads', fileName));
	return readWorkbook(new Uint8Array(bytes).buffer, fileName);
}

function sheetNamed(model: WorkbookModel, name: string): SheetModel {
	const sheet = model.sheets.find((s) => s.name === name);
	if (!sheet) throw new Error(`No sheet "${name}"`);
	return sheet;
}

const extentOf = (sheet: SheetModel) => sheet.valueExtent && rangeToA1(sheet.valueExtent);

const [pencom, wow, statz] = await Promise.all([readFixture(PENCOM), readFixture(WOW), readFixture(STATZ)]);

describe('readWorkbook on the supplied PENCOM workbook', () => {
	const model = pencom;

	it('lists all six sheets in workbook order, all visible', () => {
		expect(model.fileName).toBe(PENCOM);
		expect(model.sheets.map((s) => [s.index, s.name, s.visibility])).toEqual([
			[0, 'Dashboard', 'visible'],
			[1, 'NSN Cross-Reference', 'visible'],
			[2, 'Opportunity Matrix', 'visible'],
			[3, 'Part Number Intake', 'visible'],
			[4, 'Search Log', 'visible'],
			[5, 'Sources & Notes', 'visible']
		]);
	});

	it('bounds each sheet by its values, not by the 1000 styled empty rows in !ref', () => {
		expect(extentOf(sheetNamed(model, 'NSN Cross-Reference'))).toBe('A1:L4');
		expect(extentOf(sheetNamed(model, 'Part Number Intake'))).toBe('A1:P7');
	});

	it('reads the merged title and copies it into the covered cells', () => {
		const sheet = sheetNamed(model, 'NSN Cross-Reference');
		expect(sheet.merges).toContainEqual({ top: 1, left: 1, bottom: 1, right: 12 });
		const title = 'Confirmed and Candidate PENCOM NSN Cross-Reference';
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'text', text: title });
		expect(sheet.cell(1, 1).mergedFrom).toBeUndefined();
		expect(sheet.cell(1, 12)).toMatchObject({ ref: 'L1', kind: 'text', text: title, mergedFrom: 'A1' });
	});

	it('reads the cached result of a formula without evaluating it', () => {
		expect(sheetNamed(model, 'Dashboard').cell(6, 2)).toMatchObject({
			ref: 'B6',
			kind: 'number',
			text: '2',
			raw: 2,
			formula: "COUNTA('NSN Cross-Reference'!A3:A1000)"
		});
	});

	it('keeps text-typed identifiers exactly as stored', () => {
		const sheet = sheetNamed(model, 'NSN Cross-Reference');
		expect(sheet.cell(3, 1)).toMatchObject({ kind: 'text', text: '5305-01-658-2565' });
		expect(sheet.cell(3, 3)).toMatchObject({ kind: 'text', text: '016582565' });
		expect(sheet.cell(3, 5)).toMatchObject({ kind: 'text', text: '6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P' });
	});

	it('treats stored empty strings as empty cells', () => {
		expect(sheetNamed(model, 'Part Number Intake').cell(5, 1)).toEqual({
			ref: 'A5',
			row: 5,
			col: 1,
			kind: 'empty',
			text: '',
			raw: null
		});
	});
});

describe('readWorkbook on the supplied WOW workbook', () => {
	const model = wow;
	const sheet = sheetNamed(model, 'Active Parts');

	it('reports the metadata sheet as veryHidden', () => {
		expect(model.sheets.map((s) => [s.name, s.visibility])).toEqual([
			['Active Parts', 'visible'],
			['hiddenSheet', 'veryHidden']
		]);
	});

	it('treats the zero-width columns A-C as hidden', () => {
		expect(sheet.hiddenCols).toEqual(new Set([1, 2, 3]));
		expect(sheet.hiddenRows.size).toBe(0);
	});

	it('keeps the newline between two part numbers in D136', () => {
		expect(sheet.cell(136, 4)).toMatchObject({ ref: 'D136', kind: 'text', text: '12669555\nRVX08212' });
	});

	it('reads the modified-on column as dates with their Excel serials', () => {
		expect(sheet.cell(2, 3)).toMatchObject({
			kind: 'date',
			text: '12/12/25 2:48',
			raw: 46003.1171643519,
			numFmt: 'm/d/yy h:mm'
		});
	});

	it('bounds the sheet at A1:F180', () => {
		expect(extentOf(sheet)).toBe('A1:F180');
	});

	it('returns an empty cell for coordinates without a stored cell', () => {
		expect(sheet.cell(180, 5)).toEqual({ ref: 'E180', row: 180, col: 5, kind: 'empty', text: '', raw: null });
		expect(sheet.cell(5000, 50).kind).toBe('empty');
	});
});

describe('readWorkbook on the supplied Statz workbook', () => {
	const sheet = sheetNamed(statz, 'Sheet1');

	it('reads the vendor-prefixed part header', () => {
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'text', text: 'G & B P/N', numFmt: '@' });
	});

	it('renders a numeric drawing number as its exact integer text', () => {
		expect(sheet.cell(2, 2)).toMatchObject({ kind: 'number', text: '7646198', raw: 7646198 });
		expect(sheet.cell(2, 2).numFmt).toBeUndefined();
	});

	it('ignores the styled empty rows 59-66', () => {
		expect(extentOf(sheet)).toBe('A1:G58');
	});

	it('keeps the repeated header row as ordinary text cells', () => {
		expect(sheet.cell(34, 1)).toMatchObject({ kind: 'text', text: 'G & B P/N' });
	});
});
