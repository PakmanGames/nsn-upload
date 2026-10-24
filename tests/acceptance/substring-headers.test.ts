/**
 * `Substring Headers in Diff Sheet (1).xlsx` end to end (E4): the part column found under "Material #",
 * one FSC next to several NSNs, and headers that only mention a field. Expectations live in
 * tests/fixtures/substring-headers.ts. The shared checks mirror the FIXTURES loop in fixtures.test.ts, which
 * this fixture joins once the coordinator registers it.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import { decisionId, type WorkbookAnalysis, type WorkbookModel } from '../../src/lib/import/model';
import { colLetter } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { substringHeaders as fixture } from '../fixtures/substring-headers';
import {
	acceptAllSuggestions,
	colOf,
	expectSummaryConsistent,
	expectTraceable,
	loadFixture,
	mappedColumns,
	recordAt,
	recordsOf,
	singleRecordAt,
	tableOf
} from './helpers';

const SHEET = fixture.sheet;
const TABLE = `${SHEET}@1`;

describe(fixture.file, () => {
	let model: WorkbookModel;
	let analysis: WorkbookAnalysis;
	let accepted: WorkbookAnalysis;

	beforeAll(async () => {
		model = await loadFixture(fixture.file);
		analysis = analyze(model, [], {});
		accepted = analyze(model, [], acceptAllSuggestions(analysis));
	});

	describe('shared fixture checks', () => {
		it('classifies every sheet in workbook order', () => {
			expect(analysis.sheets.map(({ name, status }) => ({ name, status }))).toEqual(
				fixture.sheets.map(({ name, status }) => ({ name, status }))
			);
			expect(analysis.sheets[0].tables).toEqual([]);
		});

		it('finds the header, mapping, and rows', () => {
			const expected = fixture.sheets.find((sheet) => sheet.name === SHEET)!.table!;
			const table = tableOf(analysis, SHEET);
			expect(table).toMatchObject({ id: TABLE, status: 'ready', headerRows: expected.headerRows });
			expect(mappedColumns(table)).toEqual(expected.mapping);
			expect(table.dataRows).toEqual(expected.dataRows);
			expect(table.skippedRows).toEqual(expected.skippedRows);
			expect(analysis.records.filter((record) => record.tableId === table.id)).toHaveLength(expected.records);
		});

		it('summarizes the analysis before any decision', () => {
			expect(analysis.summary).toMatchObject(fixture.initial);
			expectSummaryConsistent(analysis);
		});

		it('resolves everything with "Accept all suggestions"', () => {
			expect(accepted.summary).toMatchObject(fixture.afterAcceptAll);
			expectSummaryConsistent(accepted);
			expect(toImportPlan(accepted).add).toHaveLength(accepted.summary.toImport);
		});

		it('traces every value to the cell that holds it', () => {
			expectTraceable(model, analysis);
			expectTraceable(model, accepted);
		});
	});

	describe('the part column, chosen by its values', () => {
		it('maps Material # at medium confidence and explains why', () => {
			const part = tableOf(analysis, SHEET).columns.find((column) => column.col === colOf(fixture.partColumn.column))!;
			expect(part).toMatchObject({ field: 'part', confidence: fixture.partColumn.confidence });
			expect(part.reasons).toEqual([
				"The header doesn't say Part, but a material number is usually the part number",
				'139 of 139 values look like part numbers'
			]);
		});

		it('leaves quantities, prices, and supplier columns unmapped, and offers none of them as Part', () => {
			const columns = tableOf(analysis, SHEET).columns.filter((column) =>
				fixture.unmappedColumns.includes(colLetter(column.col))
			);
			expect(columns).toHaveLength(fixture.unmappedColumns.length);
			for (const column of columns) {
				expect(column.field, column.header).toBeNull();
				expect(column.alternatives, column.header).not.toContain('part');
			}
		});

		it('explains supplier headers that only mention a field in one line', () => {
			const reasons = (letter: string) => tableOf(analysis, SHEET).columns.find((c) => c.col === colOf(letter))!.reasons;
			expect(reasons('G')).toEqual([
				'Header mentions NSN, but 0 of 68 values are valid NSNs',
				'Header mentions Part, but 0 of 68 values are plausible part numbers'
			]);
			expect(reasons('I')).toEqual(['Header mentions CAGE, but 0 of 66 values are valid CAGE codes']);
			expect(reasons('M')).toEqual(['Header mentions FSC, but 0 of 127 values are valid FSCs']);
		});

		it('imports rows 134-135 as part-only records', () => {
			for (const row of fixture.partOnlyRows) {
				const record = singleRecordAt(analysis, SHEET, row);
				expect(Object.keys(record.fields).sort(), `row ${row}`).toEqual(['description', 'part']);
				expect(record.approved, `row ${row}`).toBe(true);
			}
		});

		it('keeps an NSN listed under two part numbers as two records, with no conflict decision', () => {
			const partsByNsn = new Map<string, Set<string>>();
			for (const record of recordsOf(analysis, SHEET)) {
				const nsn = record.fields.nsn?.value;
				if (nsn) partsByNsn.set(nsn, (partsByNsn.get(nsn) ?? new Set()).add(record.fields.part!.value));
			}
			expect([...partsByNsn.values()].filter((parts) => parts.size > 1)).toHaveLength(fixture.nsnsUnderTwoParts);
			expect(analysis.decisions.filter((decision) => decision.kind === 'resolve-conflict')).toEqual([]);
		});
	});

	describe('one FSC next to several NSNs', () => {
		it('gives the FSC to the NSNs it matches only, with a note on the others and no conflict', () => {
			for (const row of fixture.fscForSomeNsnsRows) {
				const records = recordAt(analysis, SHEET, row);
				expect(records.length, `row ${row}`).toBeGreaterThan(1);
				const fsc = model.sheets.find((sheet) => sheet.name === SHEET)!.cell(row, colOf('E')).text;
				for (const record of records) {
					const where = record.id;
					expect(record.issues.some((issue) => issue.code === 'conflict'), where).toBe(false);
					if (record.fields.nsn!.value.startsWith(fsc)) {
						expect(record.fields.fsc?.value, where).toBe(fsc);
					} else {
						expect(record.fields.fsc, where).toBeUndefined();
						expect(record.issues.find((issue) => issue.field === 'fsc')).toMatchObject({ severity: 'info' });
						expect(record.fields.niin?.provenance.origin, where).toBe('derived');
					}
				}
			}
		});

		it('names where the FSC went (B10)', () => {
			const [other] = recordAt(analysis, SHEET, 10);
			expect(other.issues.find((issue) => issue.field === 'fsc')?.message).toBe(
				`FSC 5342 in ${SHEET}!E10 matches the other NSN in ${SHEET}!B10`
			);
		});

		it('leaves row 49 as the only pending decision: a single NSN under a different FSC', () => {
			const pending = analysis.decisions.filter((decision) => decision.state === 'pending');
			expect(pending.map((decision) => decision.id)).toEqual([
				decisionId('resolve-identifier-conflict', `${TABLE}:r${fixture.identifierConflictRow}`)
			]);
			expect(singleRecordAt(analysis, SHEET, fixture.identifierConflictRow)).toMatchObject({ status: 'pending', approved: false });
		});

		it('drops the second copy of the NSN that B36 lists twice', () => {
			expect(recordAt(analysis, SHEET, fixture.duplicateRow).map((record) => record.status)).toEqual(['warning', 'duplicate']);
		});
	});
});

describe('Merged Column, FSC + NIIN NSN Tests (1).xlsx', () => {
	it('no longer offers Critical Platform (AIRCRAFT, GALAXY C-5) as a part column', async () => {
		const analysis = analyze(await loadFixture('Merged Column, FSC + NIIN NSN Tests (1).xlsx'), [], {});
		const platform = analysis.sheets
			.flatMap((sheet) => sheet.tables)
			.flatMap((table) => table.columns)
			.find((column) => column.header === 'Critical Platform');
		expect(platform).toMatchObject({ field: null });
		expect(platform?.alternatives).not.toContain('part');
	});
});
