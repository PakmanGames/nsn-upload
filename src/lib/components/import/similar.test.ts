import { describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import { decisionId, type CandidateRecord, type Decision, type Overrides, type StoredMapping, type WorkbookModel } from '$lib/import/model';
import { makeSheet, makeWorkbook, type CellInput } from '$lib/import/testing';
import { describeGroup, shapeOf, similarDecisions } from './similar';

const run = (model: WorkbookModel, overrides: Overrides = {}, existing: StoredMapping[] = []) => {
	const analysis = analyze(model, existing, overrides);
	const records = new Map(analysis.records.map((record): [string, CandidateRecord] => [record.id, record]));
	const decision = (id: string) => {
		const found = analysis.decisions.find((candidate) => candidate.id === id);
		if (!found) throw new Error(`No decision ${id}`);
		return found;
	};
	return { analysis, records, decision };
};

/** Pending decisions similar to `id` for `option`, as ids. */
const similarIds = (result: ReturnType<typeof run>, id: string, option: string) =>
	similarDecisions(result.decision(id), option, result.analysis.decisions, result.records).map((decision) => decision.id);

describe('identifier conflicts', () => {
	const header = ['Part Number', 'NSN', 'NIIN', 'FSC', 'Description'];
	// Each NSN is FSC + NIIN; the cells after it agree or disagree on purpose.
	const catalog = (name: string, rows: CellInput[][]) => makeSheet(name, [header, ...rows]);
	const model = makeWorkbook('conflicts.xlsx', [
		catalog('Catalog', [
			['P-2', '5305-01-658-2565', '016582565', '5310', 'Screw'],
			['P-3', '5305-01-669-8021', '016698021', '5310', 'Screw'],
			['P-4', '5340-01-102-4535', '011024535', '5305', 'Guard'],
			['P-5', '3020-01-660-9619', '016609618', '3020', 'Carrier'],
			['P-6', '2530-00-967-3346', '009673347', '2531', 'Hub'],
			['P-7', '5305-01-658-2566', '016582566', '5305', 'Nut']
		]),
		catalog('Annex', [['A-2', '5305-01-658-2567', '016582567', '5310', 'Washer']])
	]);
	const at = (sheet: string, row: number) => decisionId('resolve-identifier-conflict', `${sheet}@1:r${row}`);

	it('groups rows whose NSN disagrees with the same fields, in the same table', () => {
		const result = run(model);
		expect(similarIds(result, at('Catalog', 2), 'prefer-nsn')).toEqual([at('Catalog', 3), at('Catalog', 4)]);
		expect(similarIds(result, at('Catalog', 5), 'prefer-nsn')).toEqual([]);
		expect(similarIds(result, at('Catalog', 6), 'prefer-nsn')).toEqual([]);
		// Same shape, another table.
		expect(similarIds(result, at('Annex', 2), 'prefer-nsn')).toEqual([]);
	});

	it('reads the disagreeing fields from the cells, whatever was chosen', () => {
		for (const choice of [undefined, 'prefer-nsn', 'prefer-niin-fsc', 'exclude-row']) {
			const overrides = choice ? { decisions: { [at('Catalog', 2)]: choice, [at('Catalog', 6)]: choice } } : {};
			const { decision, records } = run(model, overrides);
			expect(shapeOf(decision(at('Catalog', 2)), records), String(choice)).toEqual(['fsc']);
			expect(shapeOf(decision(at('Catalog', 5)), records), String(choice)).toEqual(['niin']);
			expect(shapeOf(decision(at('Catalog', 6)), records), String(choice)).toEqual(['niin', 'fsc']);
		}
	});

	it('leaves out decisions that are no longer pending', () => {
		const result = run(model, { decisions: { [at('Catalog', 3)]: 'exclude-row' } });
		expect(similarIds(result, at('Catalog', 2), 'prefer-nsn')).toEqual([at('Catalog', 4)]);
	});

	it('names the group the way the user sees it', () => {
		const { decision, records } = run(model);
		expect(describeGroup(decision(at('Catalog', 2)), 2, records, true)).toBe('2 other rows where the NSN disagrees with the FSC');
		expect(describeGroup(decision(at('Catalog', 2)), 3, records)).toBe('3 rows where the NSN disagrees with the FSC');
		expect(describeGroup(decision(at('Catalog', 5)), 1, records, true)).toBe('1 other row where the NSN disagrees with the NIIN');
		expect(describeGroup(decision(at('Catalog', 6)), 2, records)).toBe('2 rows where the NSN disagrees with the NIIN and FSC');
	});
});

describe('conflicts between sheets', () => {
	const header = ['Part Number', 'NSN', 'Description', 'CAGE'];
	const model = makeWorkbook('two-sheets.xlsx', [
		makeSheet('XRef', [
			header,
			['P-1', '5305-01-658-2565', 'Screw, machine', '0BWZ1'],
			['P-2', '5305-01-669-8021', 'Screw, assembly', '0BWZ1'],
			['P-3', '5340-01-102-4535', 'Guard', '0BWZ1']
		]),
		makeSheet('Intake', [
			header,
			['P-1', '5305-01-658-2565', 'Machine screw', '0BWZ1'],
			['P-2', '5305-01-669-8021', 'Assembly screw', '0BWZ1'],
			// Two CAGE codes conflict only through a copy without one, which keeps the three together.
			['P-3', '5340-01-102-4535', 'Guard', null],
			['P-3', '5340-01-102-4535', 'Guard', '1ABC2']
		])
	]);
	const conflict = (...ids: string[]) => decisionId('resolve-conflict', ids.sort().join('+'));
	const pair = (row: number) => conflict(`Intake@1:r${row}`, `XRef@1:r${row}`);
	const cage = conflict('Intake@1:r4', 'Intake@1:r5', 'XRef@1:r4');

	it('spreads keep-all to conflicts on the same fields, never a record-specific choice', () => {
		const result = run(model);
		expect(similarIds(result, pair(2), 'keep-all')).toEqual([pair(3)]);
		expect(similarIds(result, pair(2), 'exclude-all')).toEqual([pair(3)]);
		expect(similarIds(result, pair(2), result.decision(pair(2)).suggested)).toEqual([]);
		// P-3 differs on CAGE, not description.
		expect(shapeOf(result.decision(cage), result.records)).toEqual(['cage']);
		expect(similarIds(result, cage, 'keep-all')).toEqual([]);
		expect(describeGroup(result.decision(pair(2)), 1, result.records, true)).toBe(
			'1 other conflict where the description differs'
		);
	});
});

describe('conflicts with saved records', () => {
	const model = makeWorkbook('resend.xlsx', [
		makeSheet('Parts', [
			['Part Number', 'NSN', 'Description', 'CAGE'],
			['P-1', '5305-01-658-2565', 'Screw, machine', '0BWZ1'],
			['P-2', '5305-01-669-8021', 'Screw, assembly', '0BWZ1'],
			['P-3', '5340-01-102-4535', 'Guard', '0BWZ1']
		])
	]);
	const saved: StoredMapping[] = [
		{ id: 's1', part: 'P-1', nsn: '5305016582565', description: 'Machine screw', cage: '0BWZ1' },
		{ id: 's2', part: 'P-2', nsn: '5305016698021', description: 'Assembly screw', cage: '0BWZ1' },
		{ id: 's3', part: 'P-3', nsn: '5340011024535', description: 'Guard', cage: '1ABC2' }
	];
	const storage = (row: number, id: string) => decisionId('resolve-storage-conflict', `Parts@1:r${row}+saved:${id}`);

	it('groups rows that differ from their saved record on the same fields', () => {
		const result = run(model, {}, saved);
		expect(similarIds(result, storage(2, 's1'), 'keep-saved')).toEqual([storage(3, 's2')]);
		expect(similarIds(result, storage(4, 's3'), 'keep-saved')).toEqual([]);
		expect(describeGroup(result.decision(storage(2, 's1')), 2, result.records)).toBe(
			'2 rows already saved with a different description'
		);
	});
});

describe('several values in one row', () => {
	const model = makeWorkbook('multi.xlsx', [
		makeSheet('Parts', [
			['Part Number', 'NSN'],
			['P-1\nP-2', '5305-01-658-2565\n5305-01-669-8021'],
			['P-3\nP-4', '5340-01-102-4535\n3020-01-660-9619'],
			// Uneven counts: pairing in order is not offered.
			['P-5\nP-6\nP-7', '2530-00-967-3346\n5305-01-658-2566']
		])
	]);
	const row = (r: number) => decisionId('ambiguous-multi-value', `Parts@1:r${r}`);

	it('spreads an option only to decisions that offer it', () => {
		const result = run(model);
		expect(shapeOf(result.decision(row(2)), result.records)).toEqual(['part', 'nsn']);
		expect(similarIds(result, row(2), 'pair-in-order')).toEqual([row(3)]);
		expect(similarIds(result, row(2), 'keep-as-one')).toEqual([row(3), row(4)]);
		expect(describeGroup(result.decision(row(2)), 2, result.records, true)).toBe(
			'2 other rows with several part numbers and NSNs on separate lines'
		);
	});
});

describe('malformed values', () => {
	it('takes the column from the rejected value, not from the part number it matches', () => {
		// Enough valid NSNs for a high-confidence NSN column, so the table is included and its rows decided.
		const valid = Array.from({ length: 18 }, (_, i) => [`V-${i}`, `5305-01-658-${2500 + i}`]);
		const model = makeWorkbook('wow.xlsx', [
			makeSheet('Active Parts', [['Part Number', 'NSN'], ['12663107', '12663107'], ['P-2', '280-035-330-101F'], ...valid])
		]);
		const { analysis, records } = run(model);
		const portions = analysis.decisions.filter((decision) => decision.kind === 'import-valid-portion');
		expect(portions).toHaveLength(2);
		// The first names the matching part cell too (a likely paste into the wrong column).
		expect(portions[0].cells).toEqual(['Active Parts!B2', 'Active Parts!A2']);
		expect(portions.map((decision) => shapeOf(decision, records))).toEqual([['nsn'], ['nsn']]);
		// Applied automatically, so nothing is pending to spread to.
		expect(similarDecisions(portions[0], 'exclude-row', analysis.decisions, records)).toEqual([]);
	});
});

describe('tables that need review', () => {
	const table = (id: string, state: Decision['state'] = 'pending'): Decision => ({
		id: decisionId('include-table', id),
		kind: 'include-table',
		state,
		tableId: id,
		recordIds: [],
		cells: [],
		options: [
			{ id: 'include', label: 'Include table' },
			{ id: 'exclude', label: 'Exclude table' }
		],
		chosen: state === 'pending' ? null : 'include',
		suggested: 'exclude',
		reason: ''
	});

	it('groups every other pending table, whichever sheet it is on', () => {
		const decisions = [table('Log@2'), table('Notes@1'), table('Stock@4', 'user')];
		expect(similarDecisions(decisions[0], 'include', decisions, new Map()).map((decision) => decision.id)).toEqual([
			decisionId('include-table', 'Notes@1')
		]);
		expect(describeGroup(decisions[0], 1, new Map(), true)).toBe('1 other table that needs review');
		expect(describeGroup(decisions[0], 2, new Map())).toBe('2 tables that need review');
	});
});
