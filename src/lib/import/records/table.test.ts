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
			provenance: { original: '16582565', transforms: ['numeric-to-text', 'restore-leading-zeros'] }
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

	it('keeps the Excel error code as the original of a rejected error cell', () => {
		const sheet = sheetOf(['Part', 'NSN'], { 2: ['GRD-3001', { kind: 'error', raw: '#N/A' }] });
		const [record] = build(sheet, ['part', 'nsn']);

		expect(record.rejected).toEqual({ nsn: { original: '#N/A', cell: 'B2' } });
		expect(record).toMatchObject({ status: 'warning', approved: true });
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

	it('holds an NSN that disagrees with its NIIN or FSC as a pending conflict naming both cells', () => {
		const sheet = sheetOf(['NSN', 'NIIN', 'FSC'], {
			2: ['5305-01-658-2565', '016582566', null],
			3: ['5305-01-658-2565', null, '5310'],
			4: ['5305-01-658-2565', '016582565', '5305']
		});
		const [niinConflict, fscConflict, consistent] = build(sheet, ['nsn', 'niin', 'fsc']);

		expect(niinConflict.issues).toEqual([
			expect.objectContaining({ code: 'conflict', severity: 'error', field: 'niin', cells: [`${SHEET}!A2`, `${SHEET}!B2`] })
		]);
		expect(niinConflict).toMatchObject({ status: 'pending', approved: false });
		expect(fscConflict.issues).toEqual([
			expect.objectContaining({ code: 'conflict', field: 'fsc', cells: [`${SHEET}!A3`, `${SHEET}!C3`] })
		]);
		expect(fscConflict.fields.niin?.provenance.origin).toBe('derived');
		expect(fscConflict).toMatchObject({ status: 'pending', approved: false });
		expect(consistent).toMatchObject({ issues: [], status: 'valid' });
	});
});

describe('identifier conflict decisions', () => {
	const HEADER = ['Part', 'NSN', 'NIIN', 'FSC', 'Nomenclature', 'CAGE'];
	const FIELDS: Field[] = ['part', 'nsn', 'niin', 'fsc', 'description', 'cage'];
	// The NSN implies NIIN 016582565 and FSC 5305; the row's own NIIN and FSC cells say otherwise.
	const ROW = ['MS51957-3', '5305-01-658-2565', '016698021', '5310', 'Screw, machine', '0bwz1'];
	const choose = (choice: string) => ({
		decisions: { [decisionId('resolve-identifier-conflict', `${TABLE_ID}:r2`)]: choice }
	});

	it('keeps the NSN with prefer-nsn, rejecting the cells that disagree and deriving the NIIN', () => {
		const [record] = build(sheetOf(HEADER, { 2: ROW }), FIELDS, choose('prefer-nsn'));

		expect(record.fields.nsn?.value).toBe('5305016582565');
		expect(record.fields.niin).toMatchObject({
			value: '016582565',
			provenance: { origin: 'derived', derivedFrom: ['B2'] }
		});
		expect(record.fields.fsc).toBeUndefined();
		expect(record.rejected).toEqual({
			niin: { original: '016698021', cell: 'C2' },
			fsc: { original: '5310', cell: 'D2' }
		});
		expect(record.issues).toEqual([
			{
				code: 'conflict',
				severity: 'warning',
				field: 'niin',
				message: `NIIN in ${SHEET}!C2 disagrees with NSN in ${SHEET}!B2; kept the NSN`,
				cells: [`${SHEET}!C2`, `${SHEET}!B2`]
			},
			{
				code: 'conflict',
				severity: 'warning',
				field: 'fsc',
				message: `FSC in ${SHEET}!D2 disagrees with NSN in ${SHEET}!B2; kept the NSN`,
				cells: [`${SHEET}!D2`, `${SHEET}!B2`]
			}
		]);
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it('keeps the NIIN and FSC with prefer-niin-fsc, deriving the NSN from them', () => {
		const [record] = build(sheetOf(HEADER, { 2: ROW }), FIELDS, choose('prefer-niin-fsc'));

		expect(record.fields.nsn).toMatchObject({
			value: '5310016698021',
			provenance: { origin: 'derived', derivedFrom: ['C2', 'D2'] }
		});
		expect(record.fields.niin).toMatchObject({ value: '016698021', provenance: { origin: 'source' } });
		expect(record.fields.fsc?.value).toBe('5310');
		expect(record.rejected).toEqual({ nsn: { original: '5305-01-658-2565', cell: 'B2' } });
		expect(record.issues).toEqual([
			{
				code: 'conflict',
				severity: 'warning',
				field: 'nsn',
				message: `NSN in ${SHEET}!B2 disagrees with NIIN in ${SHEET}!C2 and FSC in ${SHEET}!D2; kept the NIIN and FSC`,
				cells: [`${SHEET}!B2`, `${SHEET}!C2`, `${SHEET}!D2`]
			}
		]);
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it('leaves a NIIN and no NSN when prefer-niin-fsc has no FSC column to derive from', () => {
		const sheet = sheetOf(['Part', 'NSN', 'NIIN'], { 2: ROW.slice(0, 3) });
		const [record] = build(sheet, ['part', 'nsn', 'niin'], choose('prefer-niin-fsc'));

		expect(record.fields.nsn).toBeUndefined();
		expect(record.fields.niin?.value).toBe('016698021');
		expect(record.rejected).toEqual({ nsn: { original: '5305-01-658-2565', cell: 'B2' } });
		expect(issue(record, 'conflict')?.message).toBe(
			`NSN in ${SHEET}!B2 disagrees with NIIN in ${SHEET}!C2; kept the NIIN`
		);
		expect(record).toMatchObject({ status: 'warning', approved: true });
	});

	it.each(['exclude-row', 'prefer-fsc'])('builds the undecided records for %s', (choice) => {
		const sheet = sheetOf(HEADER, { 2: ROW });
		const undecided = build(sheet, FIELDS);

		expect(undecided[0]).toMatchObject({ status: 'pending', approved: false });
		expect(build(sheet, FIELDS, choose(choice))).toEqual(undecided);
	});

	it('leaves part, description, and CAGE alone whichever side is chosen', () => {
		const sheet = sheetOf(HEADER, { 2: ROW });
		const { part, description, cage } = build(sheet, FIELDS)[0].fields;

		for (const choice of ['prefer-nsn', 'prefer-niin-fsc', 'exclude-row']) {
			expect(build(sheet, FIELDS, choose(choice))[0].fields).toMatchObject({ part, description, cage });
		}
	});

	it('ignores a stored choice on a row whose identifiers agree', () => {
		const sheet = sheetOf(HEADER, { 2: ['MS51957-3', '5305-01-658-2565', '016582565', '5305', 'Screw', '0bwz1'] });

		expect(build(sheet, FIELDS, choose('prefer-niin-fsc'))).toEqual(build(sheet, FIELDS));
	});
});

describe('split NSNs beside one FSC or NIIN', () => {
	const fscNote = (record: CandidateRecord) => record.issues.find((i) => i.field === 'fsc');

	it('gives the FSC only to the NSN it matches, with a note on the other record (B10 shape)', () => {
		const sheet = sheetOf(['Part', 'NSN', 'FSC'], { 10: ['1654062-3', '1680-01-581-8020\n5342-01-547-4725', '5342'] });
		const [other, owner] = build(sheet, ['part', 'nsn', 'fsc']);

		expect(owner.fields.fsc).toMatchObject({ value: '5342', provenance: { cell: 'C10', origin: 'source' } });
		expect(codes(owner)).toEqual(['split-from-multi-value']);
		expect(other.fields.fsc).toBeUndefined();
		expect(other.fields.niin).toMatchObject({ value: '015818020', provenance: { origin: 'derived', derivedFrom: ['B10'] } });
		expect(fscNote(other)).toEqual({
			code: 'split-from-multi-value',
			severity: 'info',
			field: 'fsc',
			message: `FSC 5342 in ${SHEET}!C10 matches the other NSN in ${SHEET}!B10`,
			cells: [`${SHEET}!C10`, `${SHEET}!B10`]
		});
		expect([other, owner].map((r) => [r.status, r.approved])).toEqual([
			['valid', true],
			['valid', true]
		]);
	});

	it('names the matching position when the cell lists more than two NSNs', () => {
		const nsns = '5305-01-658-2565\n1680-01-581-8020\n5305-01-669-8021';
		const first = build(sheetOf(['NSN', 'FSC'], { 2: [nsns, '5305'] }), ['nsn', 'fsc']);
		expect(first.map((r) => r.fields.fsc?.value)).toEqual(['5305', undefined, '5305']);
		expect(fscNote(first[1])?.message).toBe(`FSC 5305 in ${SHEET}!B2 matches NSNs 1 and 3 of 3 in ${SHEET}!A2`);

		const last = build(sheetOf(['NSN', 'FSC'], { 2: [nsns, '1680'] }), ['nsn', 'fsc']);
		expect(last.map((r) => r.fields.fsc?.value)).toEqual([undefined, '1680', undefined]);
		expect(fscNote(last[0])?.message).toBe(`FSC 1680 in ${SHEET}!B2 matches NSN 2 of 3 in ${SHEET}!A2`);
		expect([...first, ...last].map((r) => r.status)).toEqual(Array(6).fill('valid'));
	});

	it('gives a NIIN cell only to the NSN it matches; the other NIIN is derived from its own NSN', () => {
		const sheet = sheetOf(['NSN', 'NIIN'], { 2: ['1680-01-581-8020\n5342-01-547-4725', '015474725'] });
		const [other, owner] = build(sheet, ['nsn', 'niin']);

		expect(owner.fields.niin).toMatchObject({ value: '015474725', provenance: { cell: 'B2', origin: 'source' } });
		expect(other.fields.niin).toMatchObject({ value: '015818020', provenance: { origin: 'derived', derivedFrom: ['A2'] } });
		expect(other.issues.find((i) => i.field === 'niin')?.message).toBe(
			`NIIN 015474725 in ${SHEET}!B2 matches the other NSN in ${SHEET}!A2`
		);
		expect([other.status, owner.status]).toEqual(['valid', 'valid']);
	});

	it('keeps an FSC that every split NSN shares on every record, without a note', () => {
		const sheet = sheetOf(['NSN', 'FSC'], { 2: ['3110-00-100-3137\n3110-01-630-4025', '3110'] });
		const records = build(sheet, ['nsn', 'fsc']);

		expect(records.map((r) => r.fields.fsc?.value)).toEqual(['3110', '3110']);
		expect(records.map((r) => codes(r))).toEqual([['split-from-multi-value'], ['split-from-multi-value']]);
	});

	it('still holds every record as a conflict when the FSC matches none of the NSNs, and applies the choice to all', () => {
		const sheet = sheetOf(['NSN', 'FSC'], { 2: ['1680-01-581-8020\n5342-01-547-4725', '5305'] });
		const undecided = build(sheet, ['nsn', 'fsc']);
		expect(undecided.map((r) => [r.status, issue(r, 'conflict')?.severity])).toEqual([
			['pending', 'error'],
			['pending', 'error']
		]);

		const decisions = { [decisionId('resolve-identifier-conflict', `${TABLE_ID}:r2`)]: 'prefer-nsn' };
		for (const record of build(sheet, ['nsn', 'fsc'], { decisions })) {
			expect(record.rejected).toEqual({ fsc: { original: '5305', cell: 'B2' } });
			expect(record).toMatchObject({ status: 'warning', approved: true });
		}
	});

	it('still holds a single NSN that disagrees with its FSC (row 49 shape)', () => {
		const sheet = sheetOf(['Part', 'NSN', 'FSC'], { 49: ['HT3326-5-50', '6850-01-494-9650', '8030'] });
		const [record] = build(sheet, ['part', 'nsn', 'fsc']);

		expect(issue(record, 'conflict')).toMatchObject({ severity: 'error', field: 'fsc' });
		expect(record).toMatchObject({ status: 'pending', approved: false });
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
