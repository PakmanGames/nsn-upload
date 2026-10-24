import { describe, expect, it } from 'vitest';
import ExcelJS from 'exceljs';
import { analyzeWorkbook, detectColumns, parseRows } from './smart-upload';

describe('smart upload parsing', () => {
	it('detects common column aliases regardless of order', () => {
		expect(detectColumns(['CAGE Code', 'Nomenclature', 'P/N', 'NIIN'])).toEqual({
			part: 2,
			description: 1,
			nsn: -1,
			niin: 3,
			cage: 0
		});
	});

	it('normalizes identifiers and treats dashes as empty values', () => {
		const columns = detectColumns(['part', 'description', 'nsn', 'niin', 'cage']);
		const [row] = parseRows(
			[['-', 'Bolt', '1560-00-000-0047', '-', 'abc12']],
			columns
		);

		expect(row.input).toEqual({
			part: undefined,
			description: 'Bolt',
			nsn: '1560000000047',
			niin: undefined,
			cage: 'ABC12'
		});
		expect(row.error).toBeUndefined();
	});

	it('reports malformed and duplicate rows without dropping them', () => {
		const columns = detectColumns(['part', 'nsn']);
		const rows = parseRows(
			[
				['ABC-1', ''],
				['ABC-1', ''],
				['', '123']
			],
			columns
		);

		expect(rows[1].error).toBe('Duplicate row in this workbook.');
		expect(rows[2].error).toBe('NSN must contain 13 digits.');
	});

	it('reads the first worksheet of a real xlsx workbook', async () => {
		const workbook = new ExcelJS.Workbook();
		const sheet = workbook.addWorksheet('Parts');
		sheet.addRow(['Part Number', 'Nomenclature', 'NSN', 'CAGE Code']);
		sheet.addRow(['ABC-42', 'Hydraulic pump', '2910-01-234-5678', '1A2B3']);
		const buffer = await workbook.xlsx.writeBuffer();
		const file = new File([buffer], 'parts.xlsx');

		const analysis = await analyzeWorkbook(file);

		expect(analysis.sheetName).toBe('Parts');
		expect(analysis.rows[0].input).toMatchObject({
			part: 'ABC-42',
			description: 'Hydraulic pump',
			nsn: '2910012345678',
			cage: '1A2B3'
		});
		expect(analysis.rows[0].error).toBeUndefined();
	});
});
