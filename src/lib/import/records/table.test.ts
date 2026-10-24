import { describe, expect, it, vi } from 'vitest';
import {
	decisionId,
	type CandidateRecord,
	type Confidence,
	type Field,
	type Overrides,
	type SheetModel,
	type TableCandidate
} from '../model';
import { parseA1 } from '../refs';
import { makeSheet, type CellInput, type SheetOptions } from '../testing';
import { buildTableRecords } from './table';

vi.mock('../normalize', () => import('./fake-normalize'));

const FILE = 'WOW NSN list.xlsx';
const SHEET = 'Active Parts';
const TABLE_ID = `${SHEET}@1`;

/** Header on row 1, data at the given Excel row numbers, so tests can use real-looking refs such as D136. */
function sheetOf(header: string[], rows: Record<number, CellInput[]>, options?: SheetOptions) {
	const grid: CellInput[][] = [header];
	for (const [row, cells] of Object.entries(rows)) grid[Number(row) - 1] = cells;
	return makeSheet(SHEET, Array.from(grid, (cells) => cells ?? []), options);
}

/** A ready table whose header is row 1; `fields[i]` maps column i + 1. Data rows are the non-blank rows. */
function tableOf(
	sheet: SheetModel,
	fields: Array<Field | null>,
	confidence: Partial<Record<Field, Confidence>> = {}
): TableCandidate {
	const extent = sheet.valueExtent!;
	const dataRows: number[] = [];
	for (let row = 2; row <= extent.bottom; row++) {
		if (fields.some((_, i) => sheet.cell(row, i + 1).kind !== 'empty')) dataRows.push(row);
	}
	return {
		id: TABLE_ID,
		sheet: sheet.name,
		headerRows: [1],
		range: { ...extent, top: 1 },
		dataRows,
		skippedRows: [],
		columns: fields.map((field, i) => ({
			col: i + 1,
			header: sheet.cell(1, i + 1).text,
			field,
			confidence: field ? (confidence[field] ?? 'high') : 'low',
			reasons: [],
			alternatives: [],
			valuePassRate: null,
			overridden: false
		})),
		status: 'ready',
		confidence: 'high',
		reasons: [],
		source: 'deterministic'
	};
}

function build(
	sheet: SheetModel,
	fields: Array<Field | null>,
	overrides: Overrides = {},
	confidence?: Partial<Record<Field, Confidence>>
) {
	return buildTableRecords(FILE, sheet, tableOf(sheet, fields, confidence), overrides);
}

const codes = (record: CandidateRecord) => record.issues.map((i) => i.code);
const issue = (record: CandidateRecord, code: string) => record.issues.find((i) => i.code === code);

const PART_NSN_DESC = ['Part Number', 'NSN', 'Nomenclature'];
const WOW_HEADER = ['(Do Not Modify) Part', 'Checksum', 'Modified', 'Part Number', 'NSN', 'Nomenclature'];
const WOW_FIELDS: Array<Field | null> = [null, null, null, 'part', 'nsn', 'description'];

describe('provenance', () => {
	it('records file, sheet, row, cell, original text, and transforms for every value', () => {
		const sheet = sheetOf(['(Do Not Modify) Part', ...PART_NSN_DESC], {
			3: ['3f2b0c9e-1d4a-4b6e-9c1f-2a7d8e9f0a1b', '  457985-1 B ', '5305-01-658-2565', 'Screw, machine']
		});
		const [record] = build(sheet, [null, 'part', 'nsn', 'description']);

		const source = { file: FILE, sheet: SHEET, row: 3, origin: 'source' };
		expect(record).toMatchObject({ id: `${TABLE_ID}:r3`, tableId: TABLE_ID, sheet: SHEET, sourceRow: 3 });
		expect(record.fields.part).toEqual({
			value: '457985-1 B',
			provenance: { ...source, col: 2, cell: 'B3', original: '  457985-1 B ', transforms: ['trim'] }
		});
		expect(record.fields.nsn).toEqual({
			value: '5305016582565',
			provenance: { ...source, col: 3, cell: 'C3', original: '5305-01-658-2565', transforms: ['strip-separators'] }
		});
		expect(record.fields.description).toEqual({
			value: 'Screw, machine',
			provenance: { ...source, col: 4, cell: 'D3', original: 'Screw, machine', transforms: [] }
		});
		expect(record.fields.niin).toEqual({
			value: '016582565',
			provenance: {
				...source,
				col: 3,
				cell: 'C3',
				original: '5305-01-658-2565',
				transforms: ['derive-niin-from-nsn'],
				origin: 'derived',
				derivedFrom: ['C3']
			}
		});
		expect(record).toMatchObject({ rejected: {}, issues: [], status: 'valid', approved: true });

		for (const { provenance } of Object.values(record.fields)) {
			const { row, col } = parseA1(provenance.cell)!;
			expect(sheet.cell(row, col).text).toBe(provenance.original);
		}
	});

	it('points a merged cell at its merge master and records merge-fill', () => {
		const sheet = sheetOf(PART_NSN_DESC, { 2: ['12542334-GRN', '5305-01-658-2565'], 3: [null, '5305-01-658-2566'] }, {
			merges: [{ top: 2, left: 1, bottom: 3, right: 1 }]
		});
		const records = build(sheet, ['part', 'nsn', 'description']);

		expect(records.map((r) => r.fields.part?.value)).toEqual(['12542334-GRN', '12542334-GRN']);
		expect(records[1].fields.part?.provenance).toMatchObject({
			row: 3,
			col: 1,
			cell: 'A2',
			original: '12542334-GRN',
			transforms: ['merge-fill']
		});
		expect(records[0].fields.part?.provenance.transforms).toEqual([]);
	});

	it('reads a cell covered by a merge from another column as empty', () => {
		const sheet = sheetOf(['Part', 'Description', 'CAGE'], { 2: ['P-1', 'Screw, machine'] }, { merges: ['B2:C2'] });
		const [record] = build(sheet, ['part', 'description', 'cage']);

		expect(record.fields.description?.value).toBe('Screw, machine');
		expect(record.fields.cage).toBeUndefined();
		expect(record.rejected).toEqual({});
		expect(issue(record, 'missing-optional')).toMatchObject({ field: 'cage', cells: [`${SHEET}!C2`] });
	});

	it('passes normalizer warnings through to the record', () => {
		const sheet = sheetOf(['Part', 'NIIN'], { 2: ['PPIM 21023', 16582565] });
		const [record] = build(sheet, ['part', 'niin']);

		expect(record.fields.niin).toMatchObject({
			value: '016582565',
			provenance: { original: '16582565', transforms: ['restore-leading-zeros'] }
		});
		expect(codes(record)).toEqual(['suspicious-value']);
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});
});

describe('multi-value cells', () => {
	const d136 = () =>
		sheetOf(WOW_HEADER, { 136: [null, null, null, '12669555\nRVX08212', null, 'Valve assembly'] });

	it('splits a part cell holding two values into two records (D136 shape)', () => {
		const records = build(d136(), WOW_FIELDS);

		expect(records.map((r) => r.id)).toEqual([`${TABLE_ID}:r136.1`, `${TABLE_ID}:r136.2`]);
		expect(records.map((r) => r.fields.part?.value)).toEqual(['12669555', 'RVX08212']);
		expect(records.map((r) => r.split)).toEqual([
			{ cell: 'D136', index: 1, total: 2 },
			{ cell: 'D136', index: 2, total: 2 }
		]);
		expect(records[1].fields.part?.provenance).toMatchObject({
			cell: 'D136',
			original: '12669555\nRVX08212',
			transforms: ['split-multi-value']
		});
		expect(records[0].fields.description).toEqual(records[1].fields.description);
		expect(issue(records[1], 'split-from-multi-value')).toMatchObject({
			severity: 'info',
			field: 'part',
			cells: [`${SHEET}!D136`]
		});
		expect(records.map((r) => [r.status, r.approved])).toEqual([
			['valid', true],
			['valid', true]
		]);
	});

	it('keeps the cell as one record when the split is overridden with keep-as-one', () => {
		const overrides = { decisions: { [decisionId('split-cell', `${TABLE_ID}:r136`)]: 'keep-as-one' } };
		const records = build(d136(), WOW_FIELDS, overrides);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ id: `${TABLE_ID}:r136`, status: 'valid', approved: true });
		expect(records[0].split).toBeUndefined();
		expect(records[0].fields.part?.value).toBe('12669555\nRVX08212');
		expect(codes(records[0])).toEqual([]);
	});

	it('derives a NIIN for each NSN split from one cell, and rejects them when kept as one', () => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: ['ABC123', '5305-01-658-2565\n5305-01-658-2566'] });

		const split = build(sheet, ['part', 'nsn']);
		expect(split.map((r) => r.fields.niin?.value)).toEqual(['016582565', '016582566']);
		expect(split.map((r) => r.fields.part?.value)).toEqual(['ABC123', 'ABC123']);

		const overrides = { decisions: { [decisionId('split-cell', `${TABLE_ID}:r2`)]: 'keep-as-one' } };
		const [kept] = build(sheet, ['part', 'nsn'], overrides);
		expect(kept.fields.nsn).toBeUndefined();
		expect(kept.fields.niin).toBeUndefined();
		expect(kept.rejected.nsn).toEqual({ original: '5305-01-658-2565\n5305-01-658-2566', cell: 'B2' });
		expect(issue(kept, 'invalid-identifier')).toMatchObject({ severity: 'error', field: 'nsn' });
		expect(kept).toMatchObject({ status: 'warning', approved: true });
	});

	it('holds back a row with two multi-valued identifier cells, pairing equal counts in order', () => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: ['A100\nB200', '5305016582565\n5305016582566'] });
		const records = build(sheet, ['part', 'nsn']);

		expect(records.map((r) => [r.id, r.fields.part?.value, r.fields.nsn?.value])).toEqual([
			[`${TABLE_ID}:r2.1`, 'A100', '5305016582565'],
			[`${TABLE_ID}:r2.2`, 'B200', '5305016582566']
		]);
		for (const record of records) {
			expect(record).toMatchObject({ status: 'pending', approved: false });
			expect(record.split).toBeUndefined();
			expect(issue(record, 'ambiguous-multi-value')).toMatchObject({
				severity: 'warning',
				cells: [`${SHEET}!A2`, `${SHEET}!B2`]
			});
		}
	});

	it('keeps an uneven ambiguous row as one record with the original texts until decided', () => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: ['A100\nB200\nC300', '5305016582565\n5305016582566'] });
		const records = build(sheet, ['part', 'nsn']);

		expect(records).toHaveLength(1);
		expect(records[0]).toMatchObject({ id: `${TABLE_ID}:r2`, status: 'pending', approved: false });
		expect(records[0].fields.part?.value).toBe('A100\nB200\nC300');
		expect(records[0].rejected.nsn?.original).toBe('5305016582565\n5305016582566');
		expect(codes(records[0])).toContain('ambiguous-multi-value');
	});

	it.each([
		['pair-in-order', 'A100\nB200', 2, true],
		['keep-as-one', 'A100\nB200', 1, true],
		['exclude', 'A100\nB200', 2, false],
		['exclude', 'A100\nB200\nC300', 1, false]
	])('applies the ambiguous decision %s to parts %j', (choice, parts, count, approved) => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: [parts, '5305016582565\n5305016582566'] });
		const overrides = { decisions: { [decisionId('ambiguous-multi-value', `${TABLE_ID}:r2`)]: choice } };
		const records = build(sheet, ['part', 'nsn'], overrides);

		expect(records).toHaveLength(count);
		for (const record of records) expect(record).toMatchObject({ status: 'warning', approved });
	});

	it('ignores a stored pair-in-order choice when the value counts differ', () => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: ['A100\nB200\nC300', '5305016582565\n5305016582566'] });
		const overrides = { decisions: { [decisionId('ambiguous-multi-value', `${TABLE_ID}:r2`)]: 'pair-in-order' } };

		expect(build(sheet, ['part', 'nsn'], overrides)).toEqual(build(sheet, ['part', 'nsn']));
	});
});

describe('invalid values', () => {
	it('keeps a valid part when the NSN is malformed (E166 shape)', () => {
		const sheet = sheetOf(WOW_HEADER, { 166: [null, null, null, 'BH011-HT REV 000', '280-035-330-101F', 'Bracket'] });
		const [record] = build(sheet, WOW_FIELDS);

		expect(record.fields.part?.value).toBe('BH011-HT REV 000');
		expect(record.fields.nsn).toBeUndefined();
		expect(record.fields.niin).toBeUndefined();
		expect(record.rejected).toEqual({ nsn: { original: '280-035-330-101F', cell: 'E166' } });
		expect(issue(record, 'invalid-identifier')).toMatchObject({
			severity: 'error',
			field: 'nsn',
			cells: [`${SHEET}!E166`]
		});
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it('names the part cell when a malformed NSN equals the part number (E134 shape)', () => {
		const sheet = sheetOf(WOW_HEADER, { 134: [null, null, null, '12663107', '12663107', 'Hose'] });
		const [record] = build(sheet, WOW_FIELDS);

		const nsnIssue = issue(record, 'invalid-identifier')!;
		expect(nsnIssue.message).toMatch(/; same value as part number in Active Parts!D134$/);
		expect(nsnIssue.cells).toEqual([`${SHEET}!E134`, `${SHEET}!D134`]);
	});

	it('rejects a malformed optional value at field level', () => {
		const sheet = sheetOf(['Part', 'CAGE'], { 2: ['10931023*92', 'PENCOM'] });
		const [record] = build(sheet, ['part', 'cage']);

		expect(record.fields.cage).toBeUndefined();
		expect(record.rejected.cage).toEqual({ original: 'PENCOM', cell: 'B2' });
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it('marks a row with only a description as missing a primary identifier', () => {
		const sheet = sheetOf(PART_NSN_DESC, { 2: [null, '-', 'Spare bracket'] });
		const [record] = build(sheet, ['part', 'nsn', 'description']);

		expect(issue(record, 'missing-primary-identifier')).toMatchObject({
			severity: 'error',
			cells: [`${SHEET}!A2`, `${SHEET}!B2`]
		});
		expect(record).toMatchObject({ status: 'invalid', approved: false });
	});
});

describe('derivation and consistency', () => {
	it('derives the NSN from FSC and NIIN and labels it derived', () => {
		const sheet = sheetOf(['Part', 'FSC', 'NIIN'], { 2: ['13211E9213', '5305', '01-658-2565'] });
		const [record] = build(sheet, ['part', 'fsc', 'niin']);

		expect(record.fields.nsn).toEqual({
			value: '5305016582565',
			provenance: {
				file: FILE,
				sheet: SHEET,
				row: 2,
				col: 3,
				cell: 'C2',
				original: '01-658-2565',
				transforms: ['derive-nsn-from-fsc-niin'],
				origin: 'derived',
				derivedFrom: ['C2', 'B2']
			}
		});
		expect(record).toMatchObject({ status: 'valid', approved: true });
	});

	it('never derives over a rejected value', () => {
		const sheet = sheetOf(['Part', 'NSN', 'FSC', 'NIIN'], {
			2: ['P-1', '12663107', '5305', '016582565'],
			3: ['P-2', '5305-01-658-2565', null, '01658256X']
		});
		const [badNsn, badNiin] = build(sheet, ['part', 'nsn', 'fsc', 'niin']);

		expect(badNsn.fields.nsn).toBeUndefined();
		expect(badNiin.fields.niin).toBeUndefined();
	});

	it('flags an NSN that disagrees with its NIIN or FSC as a conflict naming both cells', () => {
		const sheet = sheetOf(['NSN', 'NIIN', 'FSC'], {
			2: ['5305-01-658-2565', '016582566', null],
			3: ['5305-01-658-2565', null, '5310'],
			4: ['5305-01-658-2565', '016582565', '5305']
		});
		const [niinConflict, fscConflict, consistent] = build(sheet, ['nsn', 'niin', 'fsc']);

		expect(niinConflict.issues).toEqual([
			expect.objectContaining({ code: 'conflict', severity: 'error', field: 'niin', cells: [`${SHEET}!A2`, `${SHEET}!B2`] })
		]);
		expect(niinConflict).toMatchObject({ status: 'invalid', approved: false });
		expect(fscConflict.issues).toEqual([
			expect.objectContaining({ code: 'conflict', field: 'fsc', cells: [`${SHEET}!A3`, `${SHEET}!C3`] })
		]);
		expect(fscConflict.fields.niin?.provenance.origin).toBe('derived');
		expect(consistent).toMatchObject({ issues: [], status: 'valid' });
	});
});

describe('table-level signals', () => {
	it('adds no per-row missing-optional when the table has no description column', () => {
		const sheet = sheetOf(['G & B P/N', 'NSN'], { 2: ['457985-1 B', '5305-01-658-2565'], 3: ['2132981-2  C', null] });
		const records = build(sheet, ['part', 'nsn']);

		expect(records.flatMap(codes)).toEqual([]);
	});

	it('warns when a mapped description or CAGE cell is empty (F180 shape)', () => {
		const sheet = sheetOf(['Part', 'Description', 'CAGE'], { 2: ['RVX08212', null, '-'] });
		const [record] = build(sheet, ['part', 'description', 'cage']);

		expect(record.issues).toEqual([
			expect.objectContaining({ code: 'missing-optional', severity: 'warning', field: 'description', cells: [`${SHEET}!B2`] }),
			expect.objectContaining({ code: 'missing-optional', severity: 'warning', field: 'cage', cells: [`${SHEET}!C2`] })
		]);
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it('flags every record when a primary column is mapped below high confidence', () => {
		const sheet = sheetOf(PART_NSN_DESC, { 2: ['P-1', '5305016582565', 'Nut'], 3: ['P-2', '5305016582566', 'Bolt'] });
		const records = build(sheet, ['part', 'nsn', 'description'], {}, { nsn: 'medium', description: 'low' });

		for (const record of records) {
			expect(record.issues).toEqual([
				expect.objectContaining({ code: 'low-confidence-mapping', severity: 'warning', field: 'nsn' })
			]);
			expect(record).toMatchObject({ status: 'warning', approved: true });
		}
	});
});
