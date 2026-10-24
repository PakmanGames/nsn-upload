import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
	InterpretationRequest,
	InterpretationTable,
	SheetAnalysis,
	SheetModel,
	TableCandidate,
	TableSpec
} from '../model';
import { materializeTable } from '../structure';
import { makeSheet, makeWorkbook } from '../testing';
import { adversarialTables, mockInterpretation } from './mock';
import { buildInterpretationRequest } from './request';
import { verifyInterpretation } from './verify';

// Stands in for T3's materializeTable: echoes the spec as a ready table so the verifier is tested alone.
vi.mock('../structure', () => ({
	materializeTable: vi.fn(
		(sheet: SheetModel, spec: TableSpec, source: TableCandidate['source']): TableCandidate => ({
			id: `${sheet.name}@${spec.headerRows[0]}`,
			sheet: sheet.name,
			headerRows: spec.headerRows,
			range: spec.range,
			dataRows: [],
			skippedRows: [],
			columns: [],
			status: 'ready',
			confidence: 'high',
			reasons: ['materialized from real cells'],
			source
		})
	)
}));

const materialize = vi.mocked(materializeTable);

const sheet = makeSheet(
	'Active Parts',
	[
		['WOW active parts'],
		['(Do Not Modify) Part', 'Part\nNumber', 'NSN', 'Nomenclature'],
		['b1c35601-c8c9-f011-bbd2-000d3a3bdce8', '10552364', '5305-01-658-2565', 'Screw'],
		['2fc45601-c8c9-f011-bbd2-000d3a3bdce8', '10607506', '5305-01-658-2566', 'Bolt'],
		['3ac45601-c8c9-f011-bbd2-000d3a3bdce8', '12669555', '', 'Nut'],
		['4bc45601-c8c9-f011-bbd2-000d3a3bdce8', 'RVX08212', '5305-01-658-2567', 'Washer']
	],
	{ hiddenCols: [1] }
);
const meta = makeSheet('hiddenSheet', [['NSN'], ['5305016582565']], { visibility: 'veryHidden' });
const model = makeWorkbook('wow.xlsx', [sheet, meta]);
const trigger: SheetAnalysis = {
	name: 'Active Parts',
	index: 0,
	status: 'needs-review',
	reasons: [],
	tables: [],
	aiTrigger: 'Two columns compete for part'
};
const request = buildInterpretationRequest(model, [trigger]);

const valid: InterpretationTable = {
	sheetName: 'Active Parts',
	range: 'A2:D6',
	headerRows: [2],
	columns: [
		{ field: 'part', col: 2, headerText: 'Part Number' },
		{ field: 'nsn', col: 3, headerText: 'NSN' },
		{ field: 'description', col: 4, headerText: 'Nomenclature' }
	],
	confidence: 0.9,
	reasons: ['header in row 2']
};

const verify = (...tables: InterpretationTable[]) =>
	verifyInterpretation(model, request, { tables });

beforeEach(() => {
	materialize.mockClear();
});

describe('verifyInterpretation', () => {
	it('accepts a correct proposal and materializes it from the real sheet', () => {
		const result = verify(valid);

		expect(result.rejected).toEqual([]);
		expect(materialize).toHaveBeenCalledWith(
			model.sheets[0],
			{
				headerRows: [2],
				range: { top: 2, left: 1, bottom: 6, right: 4 },
				columns: { 2: 'part', 3: 'nsn', 4: 'description' }
			},
			'ai'
		);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0]).toMatchObject({ status: 'ready', source: 'ai' });
		expect(result.tables[0].reasons).toEqual([
			'materialized from real cells',
			'Proposed by AI with confidence 0.90',
			'AI: header in row 2'
		]);
	});

	it('accepts absolute refs and header text that differs only in case, spacing, and punctuation', () => {
		const result = verify({
			...valid,
			range: '$A$2:$D$6',
			columns: [{ field: 'part', col: 2, headerText: '  part-number ' }]
		});

		expect(result.rejected).toEqual([]);
		expect(result.tables).toHaveLength(1);
	});

	const adversarial = adversarialTables(valid, 1);
	it.each([
		['unknownSheet', 'Sheet "Active Parts (copy)" was not part of the AI request'],
		['outOfRangeColumn', 'Column E (part) is outside the range A2:D6'],
		['offByOneHeader', 'Column B header is "10552364", but the AI read "Part Number"'],
		['duplicateField', 'Field part is mapped to both column B and column C'],
		['hiddenColumn', 'Column A (part) is hidden']
	] as const)('rejects the %s proposal with a specific reason', (kind, reason) => {
		const result = verify(adversarial[kind]);

		expect(result.tables).toEqual([]);
		expect(result.rejected).toEqual([
			{ sheetName: adversarial[kind].sheetName, range: adversarial[kind].range, reason }
		]);
		expect(materialize).not.toHaveBeenCalled();
	});

	it.each([
		[{ range: 'Active Parts' }, 'Range "Active Parts" is not a valid A1 range'],
		[{ range: 'A2:D60' }, "Range A2:D60 is outside the sheet's values (A1:D6)"],
		[{ headerRows: [1] }, 'Header row 1 is outside the range A2:D6'],
		[{ range: 'A2:D2' }, 'Range A2:D2 has no rows below the header'],
		// Without a header row there is no header text, so a model that quotes one has misread the sheet.
		[{ headerRows: [] }, 'Column B header is "", but the AI read "Part Number"'],
		[{ columns: [] }, 'No columns mapped'],
		[
			{ columns: [{ field: 'description', col: 4, headerText: 'Nomenclature' }] },
			'No part, NSN, or NIIN column mapped'
		],
		[
			{
				columns: [
					{ field: 'part', col: 2, headerText: 'Part Number' },
					{ field: 'nsn', col: 2, headerText: 'Part Number' }
				]
			},
			'Column B is mapped to both part and nsn'
		]
	] as Array<[Partial<InterpretationTable>, string]>)('rejects %o', (change, reason) => {
		const result = verify({ ...valid, ...change });

		expect(result.tables).toEqual([]);
		expect(result.rejected.map((r) => r.reason)).toEqual([reason]);
	});

	it('rejects a hidden sheet even when a tampered request names it', () => {
		const tampered: InterpretationRequest = {
			...request,
			sheets: [
				...request.sheets,
				{ name: 'hiddenSheet', extent: 'A1:A2', merges: [], reason: 'x', cells: [['A1', 'NSN']] }
			]
		};

		const result = verifyInterpretation(model, tampered, {
			tables: [
				{
					...valid,
					sheetName: 'hiddenSheet',
					range: 'A1:A2',
					headerRows: [1],
					columns: [{ field: 'nsn', col: 1, headerText: 'NSN' }]
				}
			]
		});

		expect(result.rejected.map((r) => r.reason)).toEqual(['Sheet "hiddenSheet" is hidden']);
	});

	it('rejects a visible column that was left out of the request as metadata', () => {
		const visibleUuid = makeSheet('Active Parts', [
			['(Do Not Modify) Part', 'Part Number'],
			['b1c35601-c8c9-f011-bbd2-000d3a3bdce8', '10552364'],
			['2fc45601-c8c9-f011-bbd2-000d3a3bdce8', '10607506']
		]);
		const uuidModel = makeWorkbook('wow.xlsx', [visibleUuid]);
		const uuidRequest = buildInterpretationRequest(uuidModel, [trigger]);

		const result = verifyInterpretation(uuidModel, uuidRequest, {
			tables: [
				{
					...valid,
					range: 'A1:B3',
					headerRows: [1],
					columns: [{ field: 'part', col: 1, headerText: '(Do Not Modify) Part' }]
				}
			]
		});

		expect(result.rejected.map((r) => r.reason)).toEqual([
			'Column A (part) was not included in the AI request'
		]);
	});

	it('caps a ready table at needs-review when the model is not confident', () => {
		const [table] = verify({ ...valid, confidence: 0.79 }).tables;

		expect(table.status).toBe('needs-review');
		expect(table.reasons).toContain('AI confidence is below 0.8, so the table needs review');
	});

	it('keeps only the most confident valid proposal for a sheet', () => {
		const result = verify(
			{ ...valid, confidence: 0.85 },
			{ ...adversarial.offByOneHeader, confidence: 0.95 },
			valid
		);

		expect(result.tables).toHaveLength(1);
		expect(result.tables[0].reasons).toContain('Proposed by AI with confidence 0.90');
		expect(result.rejected.map((r) => r.reason)).toEqual([
			'Column B header is "10552364", but the AI read "Part Number"',
			'Another AI proposal for this sheet was accepted; only one table per sheet is supported'
		]);
	});

	it("passes the mock interpreter's proposal for a real request, held for review", () => {
		const result = verifyInterpretation(model, request, mockInterpretation(request));

		expect(result.rejected).toEqual([]);
		expect(result.tables).toHaveLength(1);
		expect(result.tables[0]).toMatchObject({ status: 'needs-review', source: 'ai' });
		expect(materialize.mock.calls[0][1]).toEqual({
			headerRows: [2],
			range: { top: 2, left: 1, bottom: 6, right: 4 },
			columns: { 2: 'part', 3: 'nsn', 4: 'description' }
		});
	});
});

describe('verifyInterpretation, tables without a header row', () => {
	const nsns = ['5305-01-658-2565', '5305-01-669-8021', '5340-01-102-4535', '3020-01-660-9619', '2530-00-967-3346'];
	const list = makeSheet('List', nsns.map((nsn, i) => [nsn, `SE58${i}6`]));
	const listModel = makeWorkbook('list.xlsx', [list]);
	const listRequest = buildInterpretationRequest(listModel, [{ ...trigger, name: 'List' }]);
	const headerless: InterpretationTable = {
		sheetName: 'List',
		range: 'A1:B5',
		headerRows: [],
		columns: [{ field: 'nsn', col: 1, headerText: '' }],
		confidence: 0.9,
		reasons: ['no header row; column A holds NSNs']
	};
	const verifyList = (table: InterpretationTable) =>
		verifyInterpretation(listModel, listRequest, { tables: [table] });

	it('accepts one whose columns pass on their values alone', () => {
		const result = verifyList(headerless);

		expect(result.rejected).toEqual([]);
		expect(materialize).toHaveBeenCalledWith(
			list,
			{ headerRows: [], range: { top: 1, left: 1, bottom: 5, right: 2 }, columns: { 1: 'nsn' } },
			'ai'
		);
	});

	it('accepts a part column too when it is the one column whose values look like part numbers (E4)', () => {
		const result = verifyList({ ...headerless, columns: [...headerless.columns, { field: 'part', col: 2, headerText: '' }] });

		expect(result.rejected).toEqual([]);
		expect(materialize).toHaveBeenCalledWith(
			list,
			{ headerRows: [], range: { top: 1, left: 1, bottom: 5, right: 2 }, columns: { 1: 'nsn', 2: 'part' } },
			'ai'
		);
	});

	it.each([
		[
			{ columns: [{ field: 'nsn', col: 2, headerText: '' }] },
			'Column B (nsn) has no header row, and its values alone are not enough to map it (0 of 5 values are valid NSNs)'
		],
		[{ columns: [{ field: 'nsn', col: 1, headerText: 'NSN' }] }, 'Column A header is "", but the AI read "NSN"']
	] as Array<[Partial<InterpretationTable>, string]>)('rejects %o', (change, reason) => {
		const result = verifyList({ ...headerless, ...change });

		expect(result.tables).toEqual([]);
		expect(result.rejected.map((r) => r.reason)).toEqual([reason]);
		expect(materialize).not.toHaveBeenCalled();
	});
});
