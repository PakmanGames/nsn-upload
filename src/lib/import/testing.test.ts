import { describe, expect, it } from 'vitest';
import { makeSheet, makeWorkbook } from './testing';

describe('makeSheet', () => {
	it('converts plain values the way the reader does', () => {
		const sheet = makeSheet('Parts', [['12669555\r\nRVX08212', 5305016582565, true, 'a\rb']]);

		expect(sheet.cell(1, 1)).toEqual({
			ref: 'A1',
			row: 1,
			col: 1,
			kind: 'text',
			text: '12669555\nRVX08212',
			raw: '12669555\r\nRVX08212'
		});
		expect(sheet.cell(1, 2)).toMatchObject({ kind: 'number', text: '5305016582565', raw: 5305016582565 });
		expect(sheet.cell(1, 3)).toMatchObject({ kind: 'boolean', text: 'TRUE', raw: true });
		expect(sheet.cell(1, 4).text).toBe('a\nb');
	});

	it('never renders integers in exponent form', () => {
		const sheet = makeSheet('Parts', [[1e21, 0.5]]);

		expect(sheet.cell(1, 1).text).toBe('1000000000000000000000');
		expect(sheet.cell(1, 2).text).toBe('0.5');
	});

	it('accepts partial cells for dates, errors, number formats, and formulas', () => {
		const sheet = makeSheet('Parts', [
			[
				{ kind: 'date', raw: 45000, text: '3/15/2023', numFmt: 'm/d/yyyy' },
				{ kind: 'error', raw: '#N/A', formula: 'VLOOKUP(A1,B:B,1,0)' },
				{ kind: 'number', raw: 16582565, numFmt: '000000000', text: '016582565' },
				{ kind: 'empty', formula: 'A1*2' }
			]
		]);

		expect(sheet.cell(1, 1)).toMatchObject({ kind: 'date', raw: 45000, text: '3/15/2023' });
		expect(sheet.cell(1, 2)).toMatchObject({ kind: 'error', raw: '#N/A', text: '' });
		expect(sheet.cell(1, 3)).toMatchObject({ text: '016582565', numFmt: '000000000' });
		expect(sheet.cell(1, 4)).toMatchObject({ kind: 'empty', text: '', raw: null, formula: 'A1*2' });
	});

	it('computes the value extent from non-empty cells only', () => {
		const sheet = makeSheet('Parts', [
			[],
			[null, 'Part', '', undefined],
			[null, 'A-1', 'x'],
			[null, null, null, { kind: 'empty' }]
		]);

		expect(sheet.valueExtent).toEqual({ top: 2, left: 2, bottom: 3, right: 3 });
		expect(makeSheet('Empty', [[null, ''], [{ kind: 'empty' }]]).valueExtent).toBeNull();
	});

	it('returns empty cells for coordinates without a stored cell', () => {
		const sheet = makeSheet('Parts', [['A-1']]);

		expect(sheet.cell(1, 2)).toEqual({ ref: 'B1', row: 1, col: 2, kind: 'empty', text: '', raw: null });
		expect(sheet.cell(500, 30).ref).toBe('AD500');
	});

	it('copies the merge master into covered cells', () => {
		const sheet = makeSheet('Parts', [['P-1', 'NSN'], [null, '5305016582565'], [null, '5305016582566']], {
			merges: ['A1:A3', { top: 5, left: 1, bottom: 5, right: 2 }]
		});

		expect(sheet.merges).toEqual([
			{ top: 1, left: 1, bottom: 3, right: 1 },
			{ top: 5, left: 1, bottom: 5, right: 2 }
		]);
		expect(sheet.cell(1, 1).mergedFrom).toBeUndefined();
		expect(sheet.cell(3, 1)).toEqual({
			ref: 'A3',
			row: 3,
			col: 1,
			kind: 'text',
			text: 'P-1',
			raw: 'P-1',
			mergedFrom: 'A1'
		});
		expect(sheet.cell(5, 2)).toMatchObject({ kind: 'empty', mergedFrom: 'A5' });
		expect(sheet.valueExtent).toEqual({ top: 1, left: 1, bottom: 3, right: 2 });
	});

	it('applies options', () => {
		const sheet = makeSheet('Meta', [['x']], {
			index: 2,
			visibility: 'veryHidden',
			hiddenRows: [4],
			hiddenCols: new Set([1, 2, 3])
		});

		expect(sheet).toMatchObject({ name: 'Meta', index: 2, visibility: 'veryHidden', merges: [] });
		expect([...sheet.hiddenRows]).toEqual([4]);
		expect([...sheet.hiddenCols]).toEqual([1, 2, 3]);
		expect(makeSheet('Plain', [])).toMatchObject({ index: 0, visibility: 'visible', valueExtent: null });
	});

	it('rejects malformed merge ranges', () => {
		expect(() => makeSheet('Parts', [], { merges: ['A1:'] })).toThrow('Invalid merge range "A1:"');
	});
});

describe('makeWorkbook', () => {
	it('numbers sheets by position and keeps their cells', () => {
		const workbook = makeWorkbook('parts.xlsx', [makeSheet('One', [['a']]), makeSheet('Two', [['b']])]);

		expect(workbook.fileName).toBe('parts.xlsx');
		expect(workbook.sheets.map((sheet) => [sheet.name, sheet.index])).toEqual([
			['One', 0],
			['Two', 1]
		]);
		expect(workbook.sheets[1].cell(1, 1).text).toBe('b');
	});
});
