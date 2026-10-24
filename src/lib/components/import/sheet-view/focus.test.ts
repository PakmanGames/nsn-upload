import { describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import { makeSheet, makeWorkbook } from '$lib/import/testing';
import { cellsToRanges, columnFocus, recordsFocus, refsFocus, tableFocus } from './focus';

describe('cellsToRanges', () => {
	it('joins adjacent columns of a row and keeps gaps and other rows apart', () => {
		expect(
			cellsToRanges([
				{ row: 4, col: 10 },
				{ row: 4, col: 1 },
				{ row: 4, col: 11 },
				{ row: 4, col: 3 },
				{ row: 2, col: 5 },
				{ row: 4, col: 1 }
			])
		).toEqual([
			{ top: 2, left: 5, bottom: 2, right: 5 },
			{ top: 4, left: 1, bottom: 4, right: 1 },
			{ top: 4, left: 3, bottom: 4, right: 3 },
			{ top: 4, left: 10, bottom: 4, right: 11 }
		]);
	});
});

describe('recordsFocus', () => {
	// Title on row 1, header on row 2; row 4 has a malformed NSN and row 5 a part merged down from row 4.
	const model = makeWorkbook('parts.xlsx', [
		makeSheet(
			'Parts!',
			[
				['Parts list'],
				['Part Number', 'Notes', 'NSN', 'Description'],
				['ABC-1', 'x', '5305-01-658-2565', 'Screw'],
				['ABC-2', '', '12345', 'Nut'],
				[null, '', '5305-01-669-8021', 'Nut, hex']
			],
			{ merges: ['A4:A5'] }
		)
	]);
	const { records } = analyze(model, [], {});
	const at = (row: number) => records.find((record) => record.sourceRow === row)!;

	it('covers each value\'s cell, with derived values pointing at their source', () => {
		// The NIIN is derived from C3, so it adds no cell of its own.
		expect(recordsFocus([at(3)])).toEqual({
			sheet: 'Parts!',
			ranges: [
				{ top: 3, left: 1, bottom: 3, right: 1 },
				{ top: 3, left: 3, bottom: 3, right: 4 }
			],
			reason: 'Parts! row 3'
		});
	});

	it('covers rejected cells too', () => {
		expect(recordsFocus([at(4)])?.ranges).toEqual([{ top: 4, left: 1, bottom: 4, right: 1 }, { top: 4, left: 3, bottom: 4, right: 4 }]);
	});

	it('stays on the record\'s own row for a value merged down from above', () => {
		expect(recordsFocus([at(5)])?.ranges).toEqual([{ top: 5, left: 1, bottom: 5, right: 1 }, { top: 5, left: 3, bottom: 5, right: 4 }]);
	});

	it('spans several rows for several records, and is null for none', () => {
		expect(recordsFocus([at(5), at(3)])?.reason).toBe('Parts! rows 3-5');
		expect(recordsFocus([])).toBeNull();
	});
});

describe('refsFocus', () => {
	it('parses qualified refs, including a sheet name with "!", and keeps the first ref\'s sheet', () => {
		expect(refsFocus(['Parts!!E134', 'Parts!!E135', 'Other!A1', 'Parts!!G2'])).toEqual({
			sheet: 'Parts!',
			ranges: [
				{ top: 2, left: 7, bottom: 2, right: 7 },
				{ top: 134, left: 5, bottom: 134, right: 5 },
				{ top: 135, left: 5, bottom: 135, right: 5 }
			],
			reason: 'Parts! G2, E134, E135'
		});
	});

	it('is null when no ref parses', () => {
		expect(refsFocus(['no ref', '!A1'])).toBeNull();
	});
});

describe('table and column focus', () => {
	const [sheet] = analyze(makeWorkbook('t.xlsx', [makeSheet('S', [['Part', 'NSN'], ['A-1', '5305-01-658-2565'], ['A-2', '5305-01-669-8021']])]), [], {}).sheets;
	const [table] = sheet.tables;

	it('covers the table\'s range, or one column of it', () => {
		expect(tableFocus(table)).toEqual({ sheet: 'S', ranges: [{ top: 1, left: 1, bottom: 3, right: 2 }], reason: 'S A1:B3' });
		expect(columnFocus(table, 2)).toEqual({ sheet: 'S', ranges: [{ top: 1, left: 2, bottom: 3, right: 2 }], reason: 'S column B' });
	});
});
