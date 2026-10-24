/**
 * DS1 (docs/tasks/DS1-faster-decisions.md): an unseen workbook with many identifier conflicts of the same shape.
 * "Keep the NSN" is suggested, and one choice settles every conflict where the NSN disagrees with the same field,
 * the way the review window's "Also apply" checkbox does (similarDecisions + ImportSession.chooseMany).
 */
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import { similarDecisions } from '../../src/lib/components/import/similar';
import { toImportPlan } from '../../src/lib/import/validate';
import { expectSummaryConsistent, expectTraceable, singleRecordAt, useWorkbook } from './helpers';

/** NSN = FSC + NIIN. Rows 2-13 give the FSC cell 5310; rows 14-15 give a NIIN cell that differs; row 16 agrees. */
const nsnFor = (i: number) => `5305-01-658-${String(2500 + i).padStart(4, '0')}`;
const niinFor = (i: number) => `01658${String(2500 + i).padStart(4, '0')}`;
const rows = [
	['Part Number', 'NSN', 'NIIN', 'FSC', 'Description'],
	...Array.from({ length: 12 }, (_, i) => [`SCR-${i}`, nsnFor(i), niinFor(i), '5310', 'Screw, machine']),
	['NUT-1', nsnFor(20), '016589999', '5305', 'Nut, plain'],
	['NUT-2', nsnFor(21), '016589998', '5305', 'Nut, plain'],
	['WSH-1', nsnFor(30), niinFor(30), '5305', 'Washer, flat']
];

describe('many identifier conflicts of the same shape', () => {
	const workbook = useWorkbook('catalog-export.xlsx', [{ name: 'Catalog', rows }]);
	const conflicts = () =>
		workbook.analysis.decisions.filter((decision) => decision.kind === 'resolve-identifier-conflict');
	const records = () => new Map(workbook.analysis.records.map((record) => [record.id, record]));

	it('holds back all 14 conflicts, each suggesting "Keep the NSN"', () => {
		expect(conflicts()).toHaveLength(14);
		for (const decision of conflicts()) {
			expect(decision).toMatchObject({ state: 'pending', suggested: 'prefer-nsn' });
			expect(decision.options.find((option) => option.id === decision.suggested)?.label).toBe('Keep the NSN');
		}
		expect(workbook.analysis.summary).toMatchObject({ pendingDecisions: 14, toImport: 1 });
	});

	it('offers the 11 other FSC conflicts as similar to the first, and not the 2 NIIN conflicts', () => {
		const [first, ...rest] = conflicts();
		const similar = similarDecisions(first, 'prefer-nsn', workbook.analysis.decisions, records());
		expect(similar.map((decision) => decision.id)).toEqual(rest.slice(0, 11).map((decision) => decision.id));
		const niin = conflicts().slice(12);
		expect(similarDecisions(niin[0], 'prefer-nsn', workbook.analysis.decisions, records())).toEqual([niin[1]]);
	});

	it('one choice for the group imports the 12 rows with the NSN, derived NIIN and FSC, and the cells as warnings', () => {
		const [first] = conflicts();
		const group = [first, ...similarDecisions(first, 'prefer-nsn', workbook.analysis.decisions, records())];
		const chosen = analyze(workbook.model, [], {
			decisions: Object.fromEntries(group.map((decision) => [decision.id, 'prefer-nsn']))
		});

		expect(chosen.summary).toMatchObject({ pendingDecisions: 2, toImport: 13, warnings: 12 });
		for (let row = 2; row <= 13; row++) {
			const record = singleRecordAt(chosen, 'Catalog', row);
			expect(record).toMatchObject({ status: 'warning', approved: true });
			expect(record.fields.nsn?.provenance.origin).toBe('source');
			expect(record.fields.fsc).toMatchObject({ value: '5305', provenance: { origin: 'derived', transforms: ['derive-fsc-from-nsn'] } });
			expect(record.fields.niin?.provenance.origin).toBe('source');
			expect(record.rejected.fsc).toEqual({ original: '5310', cell: `D${row}` });
			expect(record.issues).toContainEqual(
				expect.objectContaining({ code: 'conflict', severity: 'warning', field: 'fsc', cells: [`Catalog!D${row}`, `Catalog!B${row}`] })
			);
		}
		// The NIIN conflicts are a different shape and still wait.
		for (const row of [14, 15]) expect(singleRecordAt(chosen, 'Catalog', row)).toMatchObject({ status: 'pending', approved: false });
		expect(toImportPlan(chosen).add).toContainEqual({
			part: 'SCR-0',
			nsn: '5305016582500',
			niin: '016582500',
			description: 'Screw, machine'
		});
		expectSummaryConsistent(chosen);
		expectTraceable(workbook.model, chosen);
	});

	it('"Accept all suggestions" keeps every NSN and derives the NIIN where its cell disagreed', () => {
		const accepted = analyze(workbook.model, [], {
			decisions: Object.fromEntries(conflicts().map((decision) => [decision.id, decision.suggested]))
		});
		expect(accepted.summary).toMatchObject({ pendingDecisions: 0, toImport: 15 });
		const nut = singleRecordAt(accepted, 'Catalog', 14);
		expect(nut.fields.niin).toMatchObject({ value: '016582520', provenance: { origin: 'derived' } });
		expect(nut.rejected.niin).toEqual({ original: '016589999', cell: 'C14' });
		expectTraceable(workbook.model, accepted);
	});
});
