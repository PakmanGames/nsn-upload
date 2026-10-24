import { describe, expect, it } from 'vitest';
import {
	colLetter,
	emptyCell,
	parseA1,
	parseRange,
	qualifiedRef,
	rangeToA1,
	toA1
} from './refs';

describe('A1 refs', () => {
	it.each([
		[1, 'A'],
		[26, 'Z'],
		[27, 'AA'],
		[52, 'AZ'],
		[53, 'BA'],
		[702, 'ZZ'],
		[703, 'AAA'],
		[16384, 'XFD']
	])('column %i is %s and parses back', (col, letters) => {
		expect(colLetter(col)).toBe(letters);
		expect(parseA1(`${letters}7`)).toEqual({ row: 7, col });
	});

	it('builds and parses cell refs', () => {
		expect(toA1(136, 4)).toBe('D136');
		expect(parseA1('D136')).toEqual({ row: 136, col: 4 });
		expect(parseA1('d136')).toEqual({ row: 136, col: 4 });
	});

	it.each(['', 'A', '1', 'A0', 'A01', '$A$1', 'A1:B2', ' A1', 'XFE1', 'A1048577', 'Sheet1!A1'])(
		'rejects %j',
		(ref) => {
			expect(parseA1(ref)).toBeNull();
		}
	);

	it('round-trips ranges and accepts single cells and reversed corners', () => {
		const range = { top: 2, left: 1, bottom: 180, right: 6 };
		expect(rangeToA1(range)).toBe('A2:F180');
		expect(parseRange('A2:F180')).toEqual(range);
		expect(parseRange('F180:A2')).toEqual(range);
		expect(parseRange('B3')).toEqual({ top: 3, left: 2, bottom: 3, right: 2 });
	});

	it.each(['', 'A1:', ':B2', 'A1:B2:C3', 'A0:B2'])('rejects range %j', (a1) => {
		expect(parseRange(a1)).toBeNull();
	});

	it('qualifies refs with the sheet name', () => {
		expect(qualifiedRef('Active Parts', 'E134')).toBe('Active Parts!E134');
	});

	it('builds empty cells', () => {
		expect(emptyCell(3, 2)).toEqual({ ref: 'B3', row: 3, col: 2, kind: 'empty', text: '', raw: null });
	});
});
