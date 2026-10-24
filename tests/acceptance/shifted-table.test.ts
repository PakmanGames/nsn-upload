/**
 * ShiftedTable.xlsx through readWorkbook() -> analyze(): two tables stacked on one sheet, the second shifted four
 * columns right, read as two tables whose records are exactly the Statz workbook's 54.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import { decisionId, type WorkbookAnalysis, type WorkbookModel } from '../../src/lib/import/model';
import { qualifiedRef, rangeToA1 } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { shiftedTable } from '../fixtures/shifted-table';
import {
	acceptAllSuggestions,
	expectSummaryConsistent,
	expectTraceable,
	loadFixture,
	mappedColumns,
	recordsOf,
	sheetOf,
	singleRecordAt
} from './helpers';

const { file, sheet: SHEET, oracle: statz } = shiftedTable;

/** Source row -> "part|NSN" for every record of the analysis. */
function pairsByRow(analysis: WorkbookAnalysis): Array<[number, string]> {
	return analysis.records
		.map((record): [number, string] => [record.sourceRow, `${record.fields.part?.value}|${record.fields.nsn?.value}`])
		.sort(([a], [b]) => a - b);
}

describe(file, () => {
	let model: WorkbookModel;
	let analysis: WorkbookAnalysis;
	let oracle: WorkbookAnalysis;

	beforeAll(async () => {
		model = await loadFixture(file);
		analysis = analyze(model, [], {});
		oracle = analyze(await loadFixture(statz.file), [], {});
	});

	it('finds two ready tables on the one sheet, each with its own columns and rows', () => {
		const sheet = sheetOf(analysis, SHEET);
		expect(sheet.status).toBe('ready');
		expect(sheet.tables).toHaveLength(shiftedTable.tables.length);
		shiftedTable.tables.forEach((expected, i) => {
			const table = sheet.tables[i];
			expect(table.id).toBe(`${SHEET}${expected.id}`);
			expect(table.status).toBe('ready');
			expect(rangeToA1(table.range)).toBe(expected.range);
			expect(table.headerRows).toEqual(expected.headerRows);
			expect(mappedColumns(table)).toEqual(expected.mapping);
			expect(table.dataRows).toEqual(expected.dataRows);
			expect(table.skippedRows).toEqual(expected.skippedRows);
			expect(analysis.records.filter((record) => record.tableId === table.id)).toHaveLength(expected.records);
		});
	});

	it('gives each table its own include decision, included automatically', () => {
		for (const { id } of shiftedTable.tables) {
			const decision = analysis.decisions.find((candidate) => candidate.id === decisionId('include-table', `${SHEET}${id}`));
			expect(decision, id).toMatchObject({ state: 'auto', chosen: 'include' });
		}
	});

	it("summarizes like Statz, with Statz's one table now two", () => {
		expect(analysis.summary).toMatchObject(shiftedTable.initial);
		expectSummaryConsistent(analysis);
		const accepted = analyze(model, [], acceptAllSuggestions(analysis));
		expect(toImportPlan(accepted).add).toHaveLength(statz.initial.toImport);
	});

	it("imports Statz's part and NSN pairs, row for row", () => {
		expect(analysis.records).toHaveLength(statz.sheets[0].table.records);
		expect(pairsByRow(analysis)).toEqual(pairsByRow(oracle));
		expect(analysis.records.every((record) => record.approved)).toBe(true);
	});

	it('keeps the real sheet name and cells in provenance', () => {
		expectTraceable(model, analysis);
		const record = singleRecordAt(analysis, SHEET, 35);
		expect(record.fields.part?.provenance).toMatchObject({ sheet: SHEET, cell: 'E35' });
		expect(record.fields.nsn?.provenance).toMatchObject({ sheet: SHEET, cell: 'G35' });
	});

	it('flags the same FSC/NIIN groups as Statz', () => {
		const flagged = recordsOf(analysis, SHEET).filter((record) =>
			record.issues.some((issue) => issue.code === 'fsc-niin-mismatch')
		);
		expect(flagged.map((record) => record.sourceRow).sort((a, b) => a - b)).toEqual(statz.fscNiinMismatchGroups.flat());
		for (const group of statz.fscNiinMismatchGroups) {
			const ids = group.map((row) => singleRecordAt(analysis, SHEET, row).id);
			for (const row of group) {
				const record = singleRecordAt(analysis, SHEET, row);
				const issue = record.issues.find((candidate) => candidate.code === 'fsc-niin-mismatch');
				expect(issue?.relatedRecords, record.id).toEqual(expect.arrayContaining(ids.filter((id) => id !== record.id)));
			}
		}
	});

	it(`retains all NSNs of the ${statz.partsWithSeveralNsns} parts that map to several`, () => {
		const nsnsByPart = new Map<string, Set<string>>();
		for (const record of analysis.records) {
			const part = record.fields.part?.value ?? '';
			nsnsByPart.set(part, (nsnsByPart.get(part) ?? new Set()).add(record.fields.nsn?.value ?? ''));
		}
		expect([...nsnsByPart.values()].filter((nsns) => nsns.size > 1)).toHaveLength(statz.partsWithSeveralNsns);
	});

	it('imports the part numbers Excel stored as dates as Excel shows them, with a warning', () => {
		for (const cell of shiftedTable.datePartCells) {
			expect(model.sheets[0].cell(Number(cell.slice(1)), 5).kind, cell).toBe('date');
			const record = singleRecordAt(analysis, SHEET, Number(cell.slice(1)));
			expect(record.fields.part?.value, cell).toBe(record.fields.part?.provenance.original);
			expect(record.issues, cell).toContainEqual(
				expect.objectContaining({ code: 'suspicious-value', field: 'part', cells: [qualifiedRef(SHEET, cell)] })
			);
		}
	});
});
