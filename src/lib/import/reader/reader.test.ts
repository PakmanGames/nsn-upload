import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ReadLimits, SheetModel } from '../model';
import { rangeToA1 } from '../refs';
import { readWorkbook } from '.';

type SheetInput = XLSX.WorkSheet | unknown[][];

/** Writes a workbook with SheetJS, the way a typical generator would. */
function xlsx(sheets: SheetInput[], hidden: Array<0 | 1 | 2> = []): ArrayBuffer {
	const workbook = XLSX.utils.book_new();
	sheets.forEach((sheet, i) =>
		XLSX.utils.book_append_sheet(workbook, Array.isArray(sheet) ? XLSX.utils.aoa_to_sheet(sheet) : sheet, `S${i + 1}`)
	);
	workbook.Workbook = { Sheets: sheets.map((_, i) => ({ Hidden: hidden[i] ?? 0 })) };
	return XLSX.write(workbook, { type: 'array', bookType: 'xlsx' });
}

/** Swaps the first sheet's cells for raw XML, for shapes that Excel writes but SheetJS's writer never produces. */
function xlsxWithSheetXml(sheetData: string, beforeSheetData = ''): ArrayBuffer {
	return editZip(xlsx([[['placeholder']]]), (zip) => {
		const entry = XLSX.CFB.find(zip, '/xl/worksheets/sheet1.xml');
		const xml: string = new TextDecoder().decode(entry.content);
		entry.content = new TextEncoder().encode(
			xml.replace(/<sheetData>.*<\/sheetData>/s, `${beforeSheetData}<sheetData>${sheetData}</sheetData>`)
		);
	});
}

function editZip(bytes: ArrayBuffer, edit: (zip: ReturnType<typeof XLSX.CFB.read>) => void): ArrayBuffer {
	const zip = XLSX.CFB.read(new Uint8Array(bytes), { type: 'array' });
	edit(zip);
	return new Uint8Array(XLSX.CFB.write(zip, { type: 'array', fileType: 'zip' })).buffer;
}

async function firstSheet(input: SheetInput | ArrayBuffer): Promise<SheetModel> {
	const bytes = input instanceof ArrayBuffer ? input : xlsx([input]);
	return (await readWorkbook(bytes, 'test.xlsx')).sheets[0];
}

const extentOf = (sheet: SheetModel) => sheet.valueExtent && rangeToA1(sheet.valueExtent);

describe('readWorkbook cell conversion', () => {
	it('renders large General-format integers exactly, never in exponent form', async () => {
		const sheet = await firstSheet([[5305016582565, 1e21]]);
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'number', text: '5305016582565', raw: 5305016582565 });
		expect(sheet.cell(1, 2).text).toBe('1000000000000000000000');
	});

	it('keeps leading zeros shown by a zero-padded format, and ignores other formatting', async () => {
		const ws = XLSX.utils.aoa_to_sheet([[16582565, 1234567, 0]]);
		ws['A1'].z = '000000000';
		ws['B1'].z = '#,##0';
		ws['C1'].z = '00000';
		const sheet = await firstSheet(ws);
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'number', text: '016582565', raw: 16582565, numFmt: '000000000' });
		expect(sheet.cell(1, 2)).toMatchObject({ text: '1234567', numFmt: '#,##0' });
		expect(sheet.cell(1, 3).text).toBe('00000');
	});

	it('renders non-integers with String()', async () => {
		expect((await firstSheet([[1.5]])).cell(1, 1)).toMatchObject({ kind: 'number', text: '1.5', raw: 1.5 });
	});

	it('normalizes CRLF and CR to LF, including the _x000D_ escape Excel writes', async () => {
		expect((await firstSheet([['a\r\nb\rc']])).cell(1, 1).text).toBe('a\nb\nc');
		const sheet = await firstSheet(
			xlsxWithSheetXml(
				'<row r="1"><c r="A1" t="inlineStr"><is><t>a_x000D_\nb</t></is></c>' +
					'<c r="B1" t="inlineStr"><is><t>c_x000D_d</t></is></c></row>'
			)
		);
		expect(sheet.cell(1, 1).text).toBe('a\nb');
		expect(sheet.cell(1, 2).text).toBe('c\nd');
	});

	it('reads rich text and literal formula strings (t="str") as plain text', async () => {
		const sheet = await firstSheet(
			xlsxWithSheetXml(
				'<row r="1"><c r="A1" t="inlineStr"><is><r><t>rich </t></r><r><rPr><b/></rPr><t>text</t></r></is></c>' +
					'<c r="B1" t="str"><v>literal</v></c></row>'
			)
		);
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'text', text: 'rich text', raw: 'rich text' });
		expect(sheet.cell(1, 2)).toMatchObject({ kind: 'text', text: 'literal' });
	});

	it('reads booleans as TRUE and FALSE', async () => {
		const sheet = await firstSheet([[true, false]]);
		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'boolean', text: 'TRUE', raw: true });
		expect(sheet.cell(1, 2)).toMatchObject({ kind: 'boolean', text: 'FALSE', raw: false });
	});

	it('reads error cells with empty text, the error code in raw, and counts them as values', async () => {
		const ws = XLSX.utils.aoa_to_sheet([['x']]);
		ws['B2'] = { t: 'e', v: 0x2a };
		ws['!ref'] = 'A1:B2';
		const sheet = await firstSheet(ws);
		expect(sheet.cell(2, 2)).toMatchObject({ kind: 'error', text: '', raw: '#N/A' });
		expect(extentOf(sheet)).toBe('A1:B2');
	});

	it('reads the cached result of a formula and keeps its source', async () => {
		const ws = XLSX.utils.aoa_to_sheet([[1]]);
		ws['B1'] = { t: 'n', v: 2, f: 'A1+1' };
		ws['C1'] = { t: 's', v: 'ok', f: 'IF(A1=1,"ok","no")' };
		ws['!ref'] = 'A1:C1';
		const sheet = await firstSheet(ws);
		expect(sheet.cell(1, 2)).toMatchObject({ kind: 'number', text: '2', raw: 2, formula: 'A1+1' });
		expect(sheet.cell(1, 3)).toMatchObject({ kind: 'text', text: 'ok', formula: 'IF(A1=1,"ok","no")' });
	});

	it('reads a formula without a cached result as empty, keeping the formula', async () => {
		// SheetJS reports this cell as { t: 'z', v: 0 }; the 0 must not leak through.
		const sheet = await firstSheet(xlsxWithSheetXml('<row r="1"><c r="A1"><v>1</v></c><c r="B1"><f>A1*2</f></c></row>'));
		expect(sheet.cell(1, 2)).toEqual({ ref: 'B1', row: 1, col: 2, kind: 'empty', text: '', raw: null, formula: 'A1*2' });
		expect(extentOf(sheet)).toBe('A1:A1');
	});

	it('reads date-formatted numbers as dates, keeping the Excel serial', async () => {
		const ws = XLSX.utils.aoa_to_sheet([[45306]]);
		ws['A1'].z = 'yyyy-mm-dd';
		expect((await firstSheet(ws)).cell(1, 1)).toMatchObject({
			kind: 'date',
			text: '2024-01-15',
			raw: 45306,
			numFmt: 'yyyy-mm-dd'
		});
	});
});

describe('readWorkbook sheet structure', () => {
	it('maps sheet visibility and keeps workbook order', async () => {
		const model = await readWorkbook(xlsx([[['a']], [['b']], [['c']]], [0, 1, 2]), 'test.xlsx');
		expect(model.sheets.map((s) => [s.index, s.name, s.visibility])).toEqual([
			[0, 'S1', 'visible'],
			[1, 'S2', 'hidden'],
			[2, 'S3', 'veryHidden']
		]);
	});

	it('collects hidden and zero-width columns', async () => {
		const ws = XLSX.utils.aoa_to_sheet([['a', 'b', 'c', 'd']]);
		ws['!cols'] = [{ wch: 10 }, { hidden: true }, { width: 0 }];
		expect((await firstSheet(ws)).hiddenCols).toEqual(new Set([2, 3]));
	});

	it('collects hidden and zero-height rows', async () => {
		const sheet = await firstSheet(
			xlsxWithSheetXml(
				'<row r="1"><c r="A1"><v>1</v></c></row>' +
					'<row r="2" hidden="1"><c r="A2"><v>2</v></c></row>' +
					'<row r="3" ht="0" customHeight="1"><c r="A3"><v>3</v></c></row>' +
					'<row r="4" ht="15" customHeight="1"><c r="A4"><v>4</v></c></row>'
			)
		);
		expect(sheet.hiddenRows).toEqual(new Set([2, 3]));
		// Hidden rows are still read; skipping them is a structure decision.
		expect(sheet.cell(2, 1).text).toBe('2');
	});

	it('copies a merge master into its covered cells and extends the extent over them', async () => {
		const ws = XLSX.utils.aoa_to_sheet([['Title'], [], ['NSN']]);
		ws['!merges'] = [XLSX.utils.decode_range('A1:C2'), XLSX.utils.decode_range('E5:F5')];
		const sheet = await firstSheet(ws);
		expect(sheet.merges).toEqual([
			{ top: 1, left: 1, bottom: 2, right: 3 },
			{ top: 5, left: 5, bottom: 5, right: 6 }
		]);
		expect(sheet.cell(2, 3)).toEqual({
			ref: 'C2',
			row: 2,
			col: 3,
			kind: 'text',
			text: 'Title',
			raw: 'Title',
			mergedFrom: 'A1'
		});
		// A merge with an empty master still marks its covered cells, but adds nothing to the extent.
		expect(sheet.cell(5, 6)).toMatchObject({ kind: 'empty', text: '', mergedFrom: 'E5' });
		expect(extentOf(sheet)).toBe('A1:C3');
	});

	it('ignores styled empty cells and empty strings when computing the extent', async () => {
		const sheet = await firstSheet(
			xlsxWithSheetXml(
				'<row r="2"><c r="B2" t="inlineStr"><is><t>value</t></is></c><c r="C2" t="inlineStr"><is><t></t></is></c></row>' +
					'<row r="1000"><c r="Z1000" s="0"/></row>'
			)
		);
		expect(extentOf(sheet)).toBe('B2:B2');
		expect(sheet.cell(1000, 26).kind).toBe('empty');
	});

	it('reports a null extent for a sheet without values', async () => {
		expect((await firstSheet(xlsxWithSheetXml('<row r="3"><c r="C3" s="0"/></row>'))).valueExtent).toBeNull();
	});
});

describe('readWorkbook errors and limits', () => {
	const small = xlsx([[['a', 'b'], ['c', 'd']]]);
	const code = (bytes: ArrayBuffer, limits: Partial<ReadLimits> = {}, fileName = 'test.xlsx') =>
		readWorkbook(bytes, fileName, limits).then(
			() => 'ok',
			(error) => (error.name === 'WorkbookReadError' ? error.code : `unexpected: ${error}`)
		);

	it('rejects files that are not named .xlsx before reading them', async () => {
		expect(await code(small, {}, 'parts.csv')).toBe('not-xlsx');
		expect(await code(small, {}, 'parts.xls')).toBe('not-xlsx');
		expect(await code(small, {}, 'PARTS.XLSX')).toBe('ok');
	});

	it('rejects files over the size limit', async () => {
		expect(await code(small, { maxFileBytes: small.byteLength - 1 })).toBe('too-large');
		expect(await code(small, { maxFileBytes: small.byteLength })).toBe('ok');
		await expect(readWorkbook(small, 'big.xlsx', { maxFileBytes: 1024 })).rejects.toThrow(
			/"big\.xlsx" is \d+(\.\d)? MB; the limit is 0 MB/
		);
	});

	it('rejects workbooks with too many sheets', async () => {
		const bytes = xlsx([[['a']], [['b']], [['c']]]);
		expect(await code(bytes, { maxSheets: 2 })).toBe('too-many-sheets');
		expect(await code(bytes, { maxSheets: 3 })).toBe('ok');
	});

	it('rejects sheets with data below the row limit, wherever the data starts', async () => {
		const ws = XLSX.utils.aoa_to_sheet([['header']]);
		XLSX.utils.sheet_add_aoa(ws, [['last']], { origin: 'A11' });
		const bytes = xlsx([ws]);
		expect(await code(bytes, { maxRowsPerSheet: 10 })).toBe('too-many-rows');
		expect(await code(bytes, { maxRowsPerSheet: 11 })).toBe('ok');
	});

	it('rejects workbooks with too many cells, counting cells covered by merges', async () => {
		expect(await code(small, { maxCells: 3 })).toBe('too-many-cells');
		expect(await code(small, { maxCells: 4 })).toBe('ok');
		const merged = XLSX.utils.aoa_to_sheet([['title']]);
		merged['!merges'] = [XLSX.utils.decode_range('A1:Z100')];
		expect(await code(xlsx([merged]), { maxCells: 2599 })).toBe('too-many-cells');
		expect(await code(xlsx([merged]), { maxCells: 2600 })).toBe('ok');
	});

	it('reports password-protected workbooks as encrypted', async () => {
		// Excel stores an encrypted .xlsx as an OLE container with these two streams.
		const container = XLSX.CFB.utils.cfb_new();
		XLSX.CFB.utils.cfb_add(container, '/EncryptionInfo', new Uint8Array(8));
		XLSX.CFB.utils.cfb_add(container, '/EncryptedPackage', new Uint8Array(64));
		const bytes = new Uint8Array(XLSX.CFB.write(container, { type: 'array' })).buffer;
		expect(await code(bytes)).toBe('encrypted');
	});

	it('reports a legacy .xls renamed to .xlsx as not-xlsx', async () => {
		const workbook = XLSX.utils.book_new();
		XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['a']]), 'S1');
		expect(await code(XLSX.write(workbook, { type: 'array', bookType: 'xls' }))).toBe('not-xlsx');
	});

	it('reports non-workbook content as corrupt instead of parsing it as CSV', async () => {
		expect(await code(new TextEncoder().encode('part,nsn\nA-1,5305016582565\n').buffer)).toBe('corrupt');
		expect(await code(new ArrayBuffer(0))).toBe('corrupt');
		expect(await code(small.slice(0, 200))).toBe('corrupt');
	});

	it('reports a workbook with a missing worksheet part as corrupt', async () => {
		// SheetJS silently drops a sheet it cannot parse, so the reader has to notice the gap.
		const bytes = editZip(small, (zip) => XLSX.CFB.utils.cfb_del(zip, '/xl/worksheets/sheet1.xml'));
		expect(await code(bytes)).toBe('corrupt');
	});
});
