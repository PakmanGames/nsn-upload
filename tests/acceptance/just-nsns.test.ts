/**
 * `Just NSNs (1).xlsx` end to end: a sheet of NSNs without a header row, found by its values and offered as one
 * decision, and the same table set up by hand. Expectations are in tests/fixtures/just-nsns.ts.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import { decisionId, type Overrides, type WorkbookAnalysis, type WorkbookModel } from '../../src/lib/import/model';
import { rangeToA1 } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { justNsns } from '../fixtures/just-nsns';
import {
	acceptAllSuggestions,
	expectSummaryConsistent,
	expectTraceable,
	loadFixture,
	mappedColumns,
	sheetOf,
	singleRecordAt,
	tableOf
} from './helpers';

const [expected] = justNsns.sheets;
const SHEET = expected.name;
const byNsn = (a: { nsn?: string }, b: { nsn?: string }) => (a.nsn ?? '').localeCompare(b.nsn ?? '');

describe(justNsns.file, () => {
	let model: WorkbookModel;
	let analysis: WorkbookAnalysis;
	let accepted: WorkbookAnalysis;
	let manual: WorkbookAnalysis;
	const manualOverrides: Overrides = { manualTables: [{ ...justNsns.manual.spec, sheet: justNsns.manual.sheet }] };

	beforeAll(async () => {
		model = await loadFixture(justNsns.file);
		analysis = analyze(model, [], {});
		accepted = analyze(model, [], acceptAllSuggestions(analysis));
		manual = analyze(model, [], manualOverrides);
	});

	describe('found by its values', () => {
		it('is one table without a header row, column A mapped to NSN at medium confidence', () => {
			const sheet = sheetOf(analysis, SHEET);
			const table = tableOf(analysis, SHEET);
			expect(sheet.status).toBe(expected.status);
			expect(table).toMatchObject({
				id: justNsns.tableId,
				headerRows: expected.table.headerRows,
				dataRows: expected.table.dataRows,
				skippedRows: expected.table.skippedRows,
				source: 'deterministic'
			});
			expect(rangeToA1(table.range)).toBe(justNsns.range);
			expect(mappedColumns(table)).toEqual(expected.table.mapping);
			expect(table.columns[0]).toMatchObject({ header: '', confidence: 'medium', valuePassRate: 1 });
			expect(table.columns[0].reasons).toEqual(['No header text', '99 of 99 values are valid NSNs']);
			for (const field of expected.table.absentOptional) expect(table.reasons.join('\n')).toMatch(new RegExp(`No ${field} column found`, 'i'));
			expect(analysis.records.filter((record) => record.tableId === table.id)).toHaveLength(expected.table.records);
		});

		it('does not ask the AI: the values already decided the table', () => {
			expect(sheetOf(analysis, SHEET).aiTrigger).toBeNull();
		});

		it('waits on one include-table decision that suggests including it', () => {
			expect(analysis.decisions).toHaveLength(1);
			expect(analysis.decisions[0]).toMatchObject({
				id: decisionId('include-table', justNsns.tableId),
				kind: 'include-table',
				state: 'pending',
				chosen: null,
				suggested: 'include'
			});
			expect(analysis.decisions[0].reason).toBe(
				`Table on ${SHEET} (${justNsns.range}) has no header row, but every value in column A is a valid NSN, so including it is suggested.`
			);
			expect(analysis.summary).toMatchObject(justNsns.initial);
			expectSummaryConsistent(analysis);
		});

		it('imports one record per distinct NSN after "Accept all suggestions"', () => {
			expect(accepted.summary).toMatchObject(justNsns.afterAcceptAll);
			expectSummaryConsistent(accepted);
			const approved = accepted.records.filter((record) => record.approved).map((record) => record.sourceRow);
			expect(approved).toEqual(justNsns.firstRows);

			const plan = toImportPlan(accepted);
			expect(plan.replace).toEqual([]);
			expect(plan.add).toHaveLength(justNsns.afterAcceptAll.toImport);
			expect(new Set(plan.add.map((input) => input.nsn)).size).toBe(plan.add.length);
			expect(plan.add).toContainEqual(justNsns.firstNsn.imported);
		});

		it('drops the later copies of an NSN as duplicates of the first', () => {
			const first = singleRecordAt(accepted, SHEET, 1);
			expect(first.fields.nsn?.provenance).toMatchObject({ cell: justNsns.firstNsn.cell, original: justNsns.firstNsn.original });
			for (const row of justNsns.firstNsn.copies) {
				expect(singleRecordAt(accepted, SHEET, row)).toMatchObject({ status: 'duplicate', approved: false });
			}
		});

		it('traces every value to its cell', () => {
			expectTraceable(model, analysis);
			expectTraceable(model, accepted);
		});
	});

	describe('set up by hand', () => {
		it('imports the same records with no decision to make', () => {
			const table = tableOf(manual, SHEET);
			expect(table).toMatchObject({ id: justNsns.tableId, source: 'user', headerRows: [], dataRows: expected.table.dataRows });
			expect(sheetOf(manual, SHEET).aiTrigger).toBeNull();
			expect(manual.decisions.filter((decision) => decision.kind === 'include-table')).toEqual([]);
			expect(manual.summary).toMatchObject({ ...justNsns.afterAcceptAll, pendingDecisions: 0 });
			expectSummaryConsistent(manual);
			expectTraceable(model, manual);
			expect(toImportPlan(manual).add.sort(byNsn)).toEqual(toImportPlan(accepted).add.sort(byNsn));
		});

		it('returns to the detected state once removed', () => {
			const { manualTables: _, ...removed } = manualOverrides;
			expect(analyze(model, [], removed)).toEqual(analysis);
		});
	});
});
