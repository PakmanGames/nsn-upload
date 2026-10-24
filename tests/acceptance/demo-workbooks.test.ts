/**
 * The demo workbooks in docs/demo-workbooks/ must keep doing what their README promises, so a live demo never
 * surprises the presenter. These tests read the committed files, not a fresh build.
 */
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { buildInterpretationRequest, verifyInterpretation } from '../../src/lib/import/ai';
import { mockInterpretation } from '../../src/lib/import/ai/mock';
import { analyze } from '../../src/lib/import/analyze';
import {
	decisionId,
	type StoredMapping,
	type WorkbookAnalysis,
	type WorkbookModel
} from '../../src/lib/import/model';
import { readWorkbook } from '../../src/lib/import/reader';
import { toImportPlan } from '../../src/lib/import/validate';
import { pencom } from '../fixtures/expectations';
import {
	acceptAllSuggestions,
	expectSummaryConsistent,
	expectTraceable,
	loadFixture,
	mappedColumns,
	recordAt,
	sheetOf,
	singleRecordAt,
	tableOf
} from './helpers';

const DEMO_DIR = new URL('../../docs/demo-workbooks/', import.meta.url);

async function loadDemo(file: string): Promise<WorkbookModel> {
	const bytes = await readFile(new URL(file, DEMO_DIR));
	return readWorkbook(new Uint8Array(bytes).buffer, file);
}

function expectContracts(model: WorkbookModel, analysis: WorkbookAnalysis) {
	expectTraceable(model, analysis);
	expectSummaryConsistent(analysis);
}

describe('demo workbooks', () => {
	describe('a: NSNs under an unfamiliar header trigger the AI path', () => {
		let model: WorkbookModel;
		let analysis: WorkbookAnalysis;
		beforeAll(async () => {
			model = await loadDemo('a-ai-unfamiliar-header.xlsx');
			analysis = analyze(model, [], {});
		});

		it('holds the table back and offers AI assistance for Stock List', () => {
			const sheet = sheetOf(analysis, 'Stock List');
			expect(sheet).toMatchObject({ status: 'needs-review' });
			expect(sheet.aiTrigger).not.toBeNull();
			const table = tableOf(analysis, 'Stock List');
			expect(table.headerRows).toEqual([4]);
			expect(mappedColumns(table)).toEqual({ nsn: 'B' });
			expect(analysis.summary).toMatchObject({ candidates: 6, pendingDecisions: 1, toImport: 0 });
			expectContracts(model, analysis);
		});

		it('gets a verified mock proposal that waits to be included, then imports 6 records', () => {
			const request = buildInterpretationRequest(model, analysis.sheets);
			expect(request.sheets.map((sheet) => sheet.name)).toEqual(['Stock List']);
			const verified = verifyInterpretation(model, request, mockInterpretation(request));
			expect(verified).toMatchObject({ rejected: [] });
			expect(verified.tables).toHaveLength(1);

			const withAi = analyze(model, [], { aiTables: verified.tables });
			const table = tableOf(withAi, 'Stock List');
			expect(table).toMatchObject({ source: 'ai', status: 'needs-review' });
			const include = decisionId('include-table', table.id);
			expect(withAi.decisions.find((decision) => decision.id === include)).toMatchObject({ state: 'pending' });

			const included = analyze(model, [], { aiTables: verified.tables, decisions: { [include]: 'include' } });
			expect(included.summary.toImport).toBe(6);
			expectContracts(model, included);
		});
	});

	describe('b: a NIIN that contradicts its NSN', () => {
		let model: WorkbookModel;
		let analysis: WorkbookAnalysis;
		const id = decisionId('resolve-identifier-conflict', 'Catalog@1:r2');
		beforeAll(async () => {
			model = await loadDemo('b-identifier-conflict.xlsx');
			analysis = analyze(model, [], {});
		});

		it('asks about row 2, suggests excluding it, and imports the other 3 rows', () => {
			expect(analysis.decisions.find((decision) => decision.id === id)).toMatchObject({
				state: 'pending',
				suggested: 'exclude-row',
				cells: expect.arrayContaining(['Catalog!B2', 'Catalog!D2'])
			});
			expect(analysis.summary).toMatchObject({ pendingDecisions: 1, toImport: 3 });
			expectContracts(model, analysis);
		});

		it.each([
			{ choice: 'prefer-nsn', nsn: '5305016582565', niin: '016582565', toImport: 4 },
			{ choice: 'prefer-niin-fsc', nsn: '5305016698021', niin: '016698021', toImport: 4 },
			{ choice: 'exclude-row', nsn: undefined, niin: undefined, toImport: 3 }
		])('$choice imports $toImport records', ({ choice, nsn, niin, toImport }) => {
			const chosen = analyze(model, [], { decisions: { [id]: choice } });
			expect(chosen.summary.toImport).toBe(toImport);
			const row2 = toImportPlan(chosen).add.find((input) => input.part === 'SCR-0001');
			expect(row2?.nsn).toBe(nsn);
			expect(row2?.niin).toBe(niin);
			expectContracts(model, chosen);
		});
	});

	describe('c: a changed copy of a saved PENCOM record', () => {
		let model: WorkbookModel;
		let analysis: WorkbookAnalysis;
		let saved: StoredMapping[];
		const [screw] = pencom.imported;
		const savedId = (part: string | undefined) => saved.find((mapping) => mapping.part === part)?.id ?? '';

		beforeAll(async () => {
			// The PENCOM import the README asks for first: "Accept all suggestions", then import.
			const workbook = await loadFixture(pencom.file);
			const imported = toImportPlan(analyze(workbook, [], acceptAllSuggestions(analyze(workbook, [], {})))).add;
			saved = imported.map((input, i) => ({ ...input, id: `saved-${i + 1}` }));
			model = await loadDemo('c-pencom-changed-copy.xlsx');
			analysis = analyze(model, saved, {});
		});

		it('skips the unchanged SE5826 and asks about the screw whose description changed', () => {
			expect(singleRecordAt(analysis, 'Changes', 3)).toMatchObject({ status: 'duplicate', approved: false });
			const changed = singleRecordAt(analysis, 'Changes', 2);
			const storage = analysis.decisions.find((decision) => decision.kind === 'resolve-storage-conflict');
			expect(storage).toMatchObject({
				id: decisionId('resolve-storage-conflict', `${changed.id}+saved:${savedId(screw.part)}`),
				state: 'pending',
				suggested: 'keep-saved',
				existingIds: [savedId(screw.part)]
			});
			expect(analysis.summary).toMatchObject({ pendingDecisions: 1, toImport: 0 });
			expectContracts(model, analysis);
		});

		it('replaces the saved screw when the user chooses "Replace the saved record"', () => {
			const storage = analysis.decisions.find((decision) => decision.kind === 'resolve-storage-conflict');
			const replaced = analyze(model, saved, { decisions: { [storage?.id ?? '']: 'replace-saved' } });
			expect(toImportPlan(replaced)).toEqual({
				add: [],
				replace: [
					{ id: savedId(screw.part), input: { ...screw, description: 'Screw, machine, pan head, SEMS' } }
				]
			});
		});
	});

	describe('d: many messy cases in one sheet', () => {
		let model: WorkbookModel;
		let analysis: WorkbookAnalysis;
		beforeAll(async () => {
			model = await loadDemo('d-messy-showcase.xlsx');
			analysis = analyze(model, [], {});
		});

		it('finds the table under the titles, ignores the metadata columns, and skips the repeated header', () => {
			const table = tableOf(analysis, 'Active Parts');
			expect(table).toMatchObject({ status: 'ready', headerRows: [4] });
			expect(mappedColumns(table)).toEqual({ part: 'C', nsn: 'D', description: 'E' });
			expect(table.skippedRows).toEqual([
				{ row: 8, reason: 'blank' },
				{ row: 9, reason: 'repeated-header' }
			]);
			expect(analysis.summary).toMatchObject({
				sourceRows: 11,
				candidates: 12,
				valid: 11,
				warnings: 1,
				splitRecords: 2,
				pendingDecisions: 0,
				toImport: 12
			});
			expectContracts(model, analysis);
		});

		it('splits the two-line part cell, rejects the malformed NSN, and keeps part punctuation', () => {
			expect(recordAt(analysis, 'Active Parts', 6).map((record) => record.fields.part?.value)).toEqual([
				'KIT-100',
				'KIT-100A'
			]);
			const malformed = singleRecordAt(analysis, 'Active Parts', 11);
			expect(malformed.rejected.nsn).toEqual({ original: '12663107', cell: 'D11' });
			expect(malformed.issues.find((issue) => issue.code === 'invalid-identifier')?.message).toContain('C11');
			expect(malformed).toMatchObject({ approved: true, fields: { part: { value: '12663107' } } });
			const parts = analysis.records.map((record) => record.fields.part?.value);
			expect(parts).toEqual(expect.arrayContaining(['10931023*92', 'BH011-HT REV 000', '457985-1 B', '2132981-2  C']));
		});
	});
});
