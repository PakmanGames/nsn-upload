import { describe, expect, it } from 'vitest';
import { FIELDS, type Cell, type CellKind, type Field, type NormalizeResult, type Transform } from '../model';
import { normalizeField } from './index';

const SHEET = 'Active Parts';
const AT = `${SHEET}!E5`;

function cell(text: string, kind: CellKind = 'text', raw: Cell['raw'] = text): Cell {
	return { ref: 'E5', row: 5, col: 5, kind, text, raw };
}
/** Integers get exact text, as the reader renders them. */
const num = (raw: number) => cell(String(raw), 'number', raw);

function ok(result: NormalizeResult) {
	if (result.kind !== 'ok') throw new Error(`expected ok, got ${JSON.stringify(result)}`);
	return result;
}
function invalidMessage(result: NormalizeResult): string {
	if (result.kind !== 'invalid') throw new Error(`expected invalid, got ${JSON.stringify(result)}`);
	return result.issue.message;
}

type OkCase = {
	name: string;
	field: Field;
	cell: Cell;
	values: Array<[value: string, transforms: Transform[]]>;
	/** Substrings of the expected suspicious-value warnings, in order. */
	warnings?: string[];
};

const OK_CASES: OkCase[] = [
	// part: trim only, punctuation and spacing survive
	...[
		'457985-1 B',
		'10931023*92',
		'6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P',
		'BH011-HT REV 000',
		'2132981-2  C',
		'PPIM 21023',
		'13211E9213',
		'201018858',
		'12542334-GRN'
	].map((value): OkCase => ({ name: `part ${value} kept intact`, field: 'part', cell: cell(value), values: [[value, []]] })),
	{ name: 'part surrounding whitespace trimmed', field: 'part', cell: cell('  12542334-GRN \n'), values: [['12542334-GRN', ['trim']]] },
	{
		name: 'part numeric cell',
		field: 'part',
		cell: num(7646198),
		values: [['7646198', ['numeric-to-text']]],
		warnings: ['stored as a number; leading zeros may have been lost']
	},
	{
		name: 'part with parenthetical annotation',
		field: 'part',
		cell: cell('12273108 (EATON M144E)'),
		values: [['12273108 (EATON M144E)', []]],
		warnings: ['contains text in parentheses']
	},
	{
		name: 'part that does not look like one',
		field: 'part',
		cell: cell('See attached drawing for details'),
		values: [['See attached drawing for details', []]],
		warnings: ['does not look like a part number']
	},
	{
		name: 'part LF multi-value',
		field: 'part',
		cell: cell('12669555\nRVX08212'),
		values: [
			['12669555', ['split-multi-value']],
			['RVX08212', ['split-multi-value']]
		]
	},
	{
		name: 'part CRLF multi-value',
		field: 'part',
		cell: cell('12669555\r\nRVX08212'),
		values: [
			['12669555', ['normalize-line-endings', 'split-multi-value']],
			['RVX08212', ['normalize-line-endings', 'split-multi-value']]
		]
	},
	{
		name: 'part multi-value with blank and padded lines',
		field: 'part',
		cell: cell('12669555\n\n  RVX08212'),
		values: [
			['12669555', ['split-multi-value']],
			['RVX08212', ['split-multi-value', 'trim']]
		]
	},
	{
		name: 'part multi-line with a note kept as one',
		field: 'part',
		cell: cell('12669555\nsee note'),
		values: [['12669555\nsee note', []]],
		warnings: ['has 2 lines, but not every line looks like a part number']
	},

	// description: trimmed, line breaks kept, never split
	{ name: 'description trimmed', field: 'description', cell: cell('  Screw, Machine  '), values: [['Screw, Machine', ['trim']]] },
	{
		name: 'description multi-line stays one value',
		field: 'description',
		cell: cell('Cover, Air Cleaner\r\nAir Inlet'),
		values: [['Cover, Air Cleaner\nAir Inlet', ['normalize-line-endings']]]
	},
	{
		name: 'description of identifier-like lines stays one value',
		field: 'description',
		cell: cell('12669555\nRVX08212'),
		values: [['12669555\nRVX08212', []]]
	},

	// nsn: separators and label stripped, exactly 13 digits
	...[
		['hyphens', '5305-01-658-2565'],
		['spaces', '5305 01 658 2565'],
		['en dashes', '5305–01–658–2565'],
		['NBSP', '5305 01 658 2565'],
		['zero-width spaces', '5305​01​658​2565'],
		['minus signs', '5305−01−658−2565']
	].map(([name, text]): OkCase => ({
		name: `nsn with ${name}`,
		field: 'nsn',
		cell: cell(text),
		values: [['5305016582565', ['strip-separators']]]
	})),
	{ name: 'nsn already digits', field: 'nsn', cell: cell('5305016582565'), values: [['5305016582565', []]] },
	{
		name: 'nsn with label',
		field: 'nsn',
		cell: cell('NSN: 5305-01-658-2565'),
		values: [['5305016582565', ['strip-label', 'strip-separators']]]
	},
	{ name: 'nsn numeric cell', field: 'nsn', cell: num(5305016582565), values: [['5305016582565', ['numeric-to-text']]] },
	{
		name: 'nsn multi-value',
		field: 'nsn',
		cell: cell('5305-01-658-2565\r\n5310-00-123-4567'),
		values: [
			['5305016582565', ['normalize-line-endings', 'split-multi-value', 'strip-separators']],
			['5310001234567', ['normalize-line-endings', 'split-multi-value', 'strip-separators']]
		]
	},

	// niin: exactly 9 digits, leading zeros restored only for numeric cells
	{ name: 'niin text keeps leading zero', field: 'niin', cell: cell('016582565'), values: [['016582565', []]] },
	{ name: 'niin with hyphens', field: 'niin', cell: cell('01-658-2565'), values: [['016582565', ['strip-separators']]] },
	{ name: 'niin with label', field: 'niin', cell: cell('NIIN 01-658-2565'), values: [['016582565', ['strip-label', 'strip-separators']]] },
	{
		name: 'niin numeric cell restores leading zeros',
		field: 'niin',
		cell: num(16582565),
		values: [['016582565', ['numeric-to-text', 'restore-leading-zeros']]],
		warnings: ['stored as a number (16582565); restored leading zeros to 016582565']
	},
	{ name: 'niin numeric cell with 9 digits', field: 'niin', cell: num(116582565), values: [['116582565', ['numeric-to-text']]] },
	{
		name: 'niin multi-value',
		field: 'niin',
		cell: cell('016582565\n001234567'),
		values: [
			['016582565', ['split-multi-value']],
			['001234567', ['split-multi-value']]
		]
	},

	// fsc: exactly 4 digits
	{ name: 'fsc text', field: 'fsc', cell: cell('5305'), values: [['5305', []]] },
	{ name: 'fsc numeric cell', field: 'fsc', cell: num(5305), values: [['5305', ['numeric-to-text']]] },
	{ name: 'fsc with label', field: 'fsc', cell: cell('FSC 5305'), values: [['5305', ['strip-label']]] },

	// cage: trimmed, uppercased, exactly 5 alphanumerics
	{ name: 'cage uppercased', field: 'cage', cell: cell('0bwz1'), values: [['0BWZ1', ['uppercase']]] },
	{ name: 'cage trimmed', field: 'cage', cell: cell(' 0BWZ1 '), values: [['0BWZ1', ['trim']]] },
	{
		name: 'cage numeric cell restores leading zeros',
		field: 'cage',
		cell: num(1234),
		values: [['01234', ['numeric-to-text', 'restore-leading-zeros']]],
		warnings: ['stored as a number (1234); restored leading zeros to 01234']
	}
];

type InvalidCase = { name: string; field: Field; cell: Cell; message: string };

const INVALID_CASES: InvalidCase[] = [
	{
		name: 'part stored as a date',
		field: 'part',
		cell: cell('3/4/2026', 'date', 46085),
		message: `Part number in ${AT} is stored as a date ("3/4/2026"); Excel converted it and the original value cannot be recovered`
	},
	{ name: 'nsn too short', field: 'nsn', cell: cell('12663107'), message: `NSN "12663107" in ${AT} has 8 digits, expected 13` },
	{
		name: 'nsn with letters',
		field: 'nsn',
		cell: cell('280-035-330-101F'),
		message: `NSN "280-035-330-101F" in ${AT} contains letters and looks like a part number`
	},
	{ name: 'nsn that is a NIIN', field: 'nsn', cell: cell('01-658-2565'), message: `NSN "01-658-2565" in ${AT} has 9 digits and looks like a NIIN` },
	{ name: 'nsn placeholder text', field: 'nsn', cell: cell('N/A'), message: `NSN "N/A" in ${AT} contains no digits` },
	{ name: 'nsn yes/no flag', field: 'nsn', cell: cell('Yes'), message: `NSN "Yes" in ${AT} contains no digits` },
	{
		name: 'nsn with dots',
		field: 'nsn',
		cell: cell('5305.01.658.2565'),
		message: `NSN "5305.01.658.2565" in ${AT} contains characters other than digits and separators`
	},
	{
		name: 'nsn multi-value with a bad line',
		field: 'nsn',
		cell: cell('5305-01-658-2565\n123'),
		message: `NSN cell ${AT} has 2 lines, but not all are valid NSNs: "5305-01-658-2565" is valid; "123" has 3 digits, expected 13`
	},
	{ name: 'niin that is an NSN', field: 'niin', cell: cell('5305-01-658-2565'), message: `NIIN "5305-01-658-2565" in ${AT} has 13 digits and looks like an NSN` },
	{ name: 'niin text with 8 digits', field: 'niin', cell: cell('16582565'), message: `NIIN "16582565" in ${AT} has 8 digits, expected 9` },
	{ name: 'niin numeric decimal', field: 'niin', cell: num(46003.5), message: `NIIN "46003.5" in ${AT} contains characters other than digits and separators` },
	{ name: 'fsc too long', field: 'fsc', cell: cell('53051'), message: `FSC "53051" in ${AT} has 5 digits, expected 4` },
	{ name: 'fsc multi-line is not split', field: 'fsc', cell: cell('5305\n5310'), message: `FSC "5305\n5310" in ${AT} has 8 digits, expected 4` },
	{ name: 'cage vendor name', field: 'cage', cell: cell('PENCOM'), message: `CAGE "PENCOM" in ${AT} has 6 characters, expected 5 letters or digits` },
	{ name: 'cage yes/no flag', field: 'cage', cell: cell('Y'), message: `CAGE "Y" in ${AT} has 1 character, expected 5 letters or digits` },
	{ name: 'cage punctuation', field: 'cage', cell: cell('0B-Z1'), message: `CAGE "0B-Z1" in ${AT} contains characters other than letters and digits` },
	{ name: 'cage multi-line is not split', field: 'cage', cell: cell('0BWZ1\n1A2B3'), message: `CAGE "0BWZ1\n1A2B3" in ${AT} contains characters other than letters and digits` }
];

describe('normalizeField', () => {
	it.each(OK_CASES)('$name', ({ field, cell, values, warnings = [] }) => {
		const result = ok(normalizeField(field, cell, SHEET));
		expect(result.values.map((v) => [v.value, v.transforms])).toEqual(values);
		expect(result.warnings).toHaveLength(warnings.length);
		result.warnings.forEach((issue, i) => {
			expect(issue).toMatchObject({ code: 'suspicious-value', severity: 'warning', field, cells: [AT] });
			expect(issue.message).toContain(warnings[i]);
		});
	});

	it.each(INVALID_CASES)('$name', ({ field, cell, message }) => {
		const result = normalizeField(field, cell, SHEET);
		expect(invalidMessage(result)).toBe(message);
		expect(result).toMatchObject({ issue: { code: 'invalid-identifier', severity: 'error', field, cells: [AT] } });
	});

	describe.each(FIELDS)('%s', (field) => {
		it.each([
			['an empty cell', cell('', 'empty', null)],
			['a whitespace-only cell', cell(' \r\n\t ')],
			['a lone hyphen', cell('-')],
			['a padded hyphen', cell('  -  ')],
			['a lone en dash', cell('–')]
		])('treats %s as empty', (_, input) => {
			expect(normalizeField(field, input, SHEET)).toEqual({ kind: 'empty' });
		});

		it('reports an Excel error value as invalid', () => {
			const result = normalizeField(field, cell('', 'error', '#N/A'), SHEET);
			expect(result).toEqual({
				kind: 'invalid',
				issue: {
					code: 'invalid-identifier',
					severity: 'error',
					field,
					message: `Excel error value #N/A in ${AT}`,
					cells: [AT]
				}
			});
		});
	});

	it('qualifies refs with the sheet name and cell ref', () => {
		const input: Cell = { ref: 'E134', row: 134, col: 5, kind: 'text', text: '12663107', raw: '12663107' };
		const result = normalizeField('nsn', input, 'Sources & Notes');
		expect(result).toMatchObject({ issue: { cells: ['Sources & Notes!E134'] } });
		expect(invalidMessage(result)).toContain('in Sources & Notes!E134');
	});
});
