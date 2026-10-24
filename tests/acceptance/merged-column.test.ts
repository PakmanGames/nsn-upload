/**
 * The merged-column workbook end to end (tests/fixtures/merged-column.ts), and the merged-header layouts it
 * stands for, written with ExcelJS: a header merged across two columns is one column when only one of them
 * holds values, and two columns judged by their own values when both do.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import type { WorkbookAnalysis, WorkbookModel } from '../../src/lib/import/model';
import { colLetter, rangeToA1 } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { rows } from '../fixtures/expectations';
import { mergedColumn } from '../fixtures/merged-column';
import {
	acceptAllSuggestions,
	colOf,
	digits,
	expectSummaryConsistent,
	expectTraceable,
	loadFixture,
	mappedColumns,
	NSN,
	recordsOf,
	singleRecordAt,
	tableOf,
	useWorkbook
} from './helpers';

const letters = (analysis: WorkbookAnalysis, sheet: string) => tableOf(analysis, sheet).columns.map((c) => colLetter(c.col));
const column = (analysis: WorkbookAnalysis, sheet: string, letter: string) =>
	tableOf(analysis, sheet).columns.find((c) => c.col === colOf(letter));

describe(mergedColumn.file, () => {
	const [sheet] = mergedColumn.sheets;
	const SHEET = sheet.name;
	let model: WorkbookModel;
	let analysis: WorkbookAnalysis;
	let accepted: WorkbookAnalysis;

	beforeAll(async () => {
		model = await loadFixture(mergedColumn.file);
		analysis = analyze(model, [], {});
		accepted = analyze(model, [], acceptAllSuggestions(analysis));
	});

	it('finds one ready table with its header on row 6', () => {
		expect(analysis.sheets.map(({ name, status }) => ({ name, status }))).toEqual(
			mergedColumn.sheets.map(({ name, status }) => ({ name, status }))
		);
		const table = tableOf(analysis, SHEET);
		expect(table).toMatchObject({ id: `${SHEET}@6`, status: 'ready', headerRows: sheet.table.headerRows });
		expect(mappedColumns(table)).toEqual(sheet.table.mapping);
	});

	it('ends the table at row 30, lists the rows under the blank gap as skipped, and says why', () => {
		const table = tableOf(analysis, SHEET);
		expect(rangeToA1(table.range)).toBe(mergedColumn.range);
		expect(table.dataRows).toEqual(sheet.table.dataRows);
		expect(table.skippedRows).toEqual(sheet.table.skippedRows);
		expect(table.reasons).toContain(mergedColumn.belowTableReason);
		expect(recordsOf(analysis, SHEET).filter((record) => record.sourceRow > 30)).toEqual([]);
	});

	it('maps FSC and NIIN at high confidence, every value passing', () => {
		for (const field of ['fsc', 'niin'] as const) {
			expect(column(analysis, SHEET, sheet.table.mapping[field])).toMatchObject({ field, confidence: 'high', valuePassRate: 1 });
		}
	});

	it('lists the merged NIIN column once and says why column C is left out', () => {
		const { dropped, reason } = mergedColumn.mergedHeader;
		expect(letters(analysis, SHEET)).not.toContain(dropped);
		expect(tableOf(analysis, SHEET).reasons).toContain(reason);
		expect(column(analysis, SHEET, 'B')?.header).toBe('NIIN');
	});

	it('lists the supplier columns without a header as columns that are not imported', () => {
		for (const letter of mergedColumn.unlabeledColumns) {
			expect(column(analysis, SHEET, letter), letter).toMatchObject({ header: '', field: null, alternatives: [] });
		}
	});

	it('imports 24 records whose NSN is derived from FSC + NIIN', () => {
		const records = recordsOf(analysis, SHEET);
		expect(records).toHaveLength(sheet.table.records);
		for (const record of records) {
			const { fsc, niin, nsn } = record.fields;
			expect(record, record.id).toMatchObject({ status: 'valid', approved: true });
			expect(niin?.provenance, record.id).toMatchObject({ cell: `B${record.sourceRow}`, origin: 'source' });
			expect(nsn?.value, record.id).toBe(`${fsc?.value}${niin?.value}`);
			expect(nsn?.provenance, record.id).toMatchObject({
				origin: 'derived',
				transforms: ['derive-nsn-from-fsc-niin'],
				derivedFrom: [`B${record.sourceRow}`, `A${record.sourceRow}`]
			});
		}
		const { row, ...values } = mergedColumn.firstRecord;
		const first = singleRecordAt(analysis, SHEET, row);
		expect({ fsc: first.fields.fsc?.value, niin: first.fields.niin?.value, nsn: first.fields.nsn?.value }).toEqual(values);
	});

	it('summarizes 24 records, none invalid, and imports them all', () => {
		expect(analysis.summary).toMatchObject(mergedColumn.initial);
		expect(accepted.summary).toMatchObject(mergedColumn.afterAcceptAll);
		expectSummaryConsistent(analysis);
		expect(toImportPlan(accepted).add).toHaveLength(mergedColumn.initial.toImport);
	});

	it('reports the missing Description and CAGE columns once, at table level', () => {
		const reasons = tableOf(analysis, SHEET).reasons.join('\n');
		for (const field of sheet.table.absentOptional) expect(reasons).toMatch(new RegExp(field, 'i'));
		expect(analysis.records.flatMap((record) => record.issues)).toEqual([]);
	});

	it('traces every value to the cell that holds it', () => {
		expectTraceable(model, analysis);
	});
});

describe('merged header variants', () => {
	const FSC = NSN.map((nsn) => digits(nsn).slice(0, 4));
	const NIIN = NSN.map((nsn) => digits(nsn).slice(4));
	const PART = ['BRK-1001', 'VLV-220 REV B', '7731-44*2', 'HSG-9/A', 'PIN-50-1'];
	const DATA = rows(2, 6);
	const acrossBC = DATA.map((row) => `B${row}:C${row}`);

	describe('header and every value merged across B:C', () => {
		const workbook = useWorkbook('merged-niin.xlsx', [
			{
				name: 'Quote',
				rows: [['Part Number', 'NIIN', null, 'Description'], ...PART.map((part, i) => [part, NIIN[i], null, 'Screw, machine'])],
				merges: ['B1:C1', ...acrossBC]
			}
		]);

		it('reads one NIIN column B and does not list C', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Quote'))).toEqual({ part: 'A', niin: 'B', description: 'D' });
			expect(letters(workbook.analysis, 'Quote')).toEqual(['A', 'B', 'D']);
			expect(column(workbook.analysis, 'Quote', 'B')).toMatchObject({ confidence: 'high', valuePassRate: 1 });
			expect(tableOf(workbook.analysis, 'Quote').reasons).toContain(
				'Column C shares the merged "NIIN" header with column B and has no values of its own, so they are one column'
			);
			for (const [i, row] of DATA.entries()) {
				expect(singleRecordAt(workbook.analysis, 'Quote', row).fields.niin).toMatchObject({ value: NIIN[i], provenance: { cell: `B${row}` } });
			}
		});
	});

	describe('header merged across B:C with the values in C only', () => {
		const workbook = useWorkbook('niin-in-c.xlsx', [
			{ name: 'Quote', rows: [['Part Number', 'NIIN', null], ...PART.map((part, i) => [part, null, NIIN[i]])], merges: ['B1:C1'] }
		]);

		it('maps C to NIIN and loses no value', () => {
			const table = tableOf(workbook.analysis, 'Quote');
			expect(mappedColumns(table)).toEqual({ part: 'A', niin: 'C' });
			expect(letters(workbook.analysis, 'Quote')).toEqual(['A', 'C']);
			expect(column(workbook.analysis, 'Quote', 'C')).toMatchObject({ header: 'NIIN', confidence: 'high' });
			expect(table.reasons).toContain(
				'Column B shares the merged "NIIN" header with column C and has no values of its own, so they are one column'
			);
			expect(recordsOf(workbook.analysis, 'Quote').map((record) => record.fields.niin?.value)).toEqual(NIIN);
			expect(workbook.analysis.summary.toImport).toBe(5);
		});
	});

	describe('"NSN" merged across A:B, with the FSC in A and the NIIN in B', () => {
		const workbook = useWorkbook('split-nsn.xlsx', [
			{
				name: 'Quote',
				rows: [['NSN', null, 'Part Number'], ...NSN.map((nsn, i) => [FSC[i], nsn.slice(5), PART[i]])],
				merges: ['A1:B1']
			}
		]);

		it('maps A to FSC and B to NIIN by their values, and derives the NSN', () => {
			const table = tableOf(workbook.analysis, 'Quote');
			expect(table.status).toBe('ready');
			expect(mappedColumns(table)).toEqual({ fsc: 'A', niin: 'B', part: 'C' });
			expect(column(workbook.analysis, 'Quote', 'A')?.reasons[0]).toBe('Shares the merged "NSN" header with column B');
			expect(column(workbook.analysis, 'Quote', 'B')?.reasons[0]).toBe('Shares the merged "NSN" header with column A');
			for (const [i, row] of DATA.entries()) {
				expect(singleRecordAt(workbook.analysis, 'Quote', row).fields.nsn).toMatchObject({
					value: digits(NSN[i]),
					provenance: { origin: 'derived', derivedFrom: [`B${row}`, `A${row}`] }
				});
			}
			expect(workbook.analysis.summary.toImport).toBe(5);
		});
	});

	describe('"NSN" merged across B:C over whole NSNs', () => {
		const workbook = useWorkbook('merged-nsn.xlsx', [
			{ name: 'Quote', rows: [['Part Number', 'NSN', null], ...PART.map((part, i) => [part, NSN[i], null])], merges: ['B1:C1', ...acrossBC] }
		]);

		it('still reads B as the NSN column, not as an FSC or NIIN part', () => {
			expect(mappedColumns(tableOf(workbook.analysis, 'Quote'))).toEqual({ part: 'A', nsn: 'B' });
			expect(column(workbook.analysis, 'Quote', 'B')).toMatchObject({ confidence: 'high' });
			expect(letters(workbook.analysis, 'Quote')).toEqual(['A', 'B']);
		});
	});

	describe('header merged across B:C, with other values in C on some rows', () => {
		const workbook = useWorkbook('niin-and-notes.xlsx', [
			{
				name: 'Quote',
				rows: [
					['Part Number', 'NIIN', null],
					...PART.map((part, i) => [part, NIIN[i], i === 1 ? NIIN[4] : i === 3 ? 'superseded' : null])
				],
				merges: ['B1:C1']
			}
		]);

		it('keeps both columns, maps the better one, and lists the other with a reason', () => {
			const table = tableOf(workbook.analysis, 'Quote');
			expect(table.status).toBe('ready');
			expect(mappedColumns(table)).toEqual({ part: 'A', niin: 'B' });
			expect(column(workbook.analysis, 'Quote', 'B')).toMatchObject({ confidence: 'high', valuePassRate: 1 });
			const c = column(workbook.analysis, 'Quote', 'C');
			expect(c).toMatchObject({ header: 'NIIN', field: null, alternatives: ['niin'] });
			expect(c?.reasons).toEqual([
				'Shares the merged "NIIN" header with column B',
				"Header 'NIIN' matches NIIN",
				'1 of 2 values are valid NIINs',
				'Also fits NIIN, but another column was a better fit'
			]);
			expect(recordsOf(workbook.analysis, 'Quote').map((record) => record.fields.niin?.value)).toEqual(NIIN);
		});
	});

	describe('a part merged down several rows under a merged NIIN header', () => {
		const workbook = useWorkbook('merged-down.xlsx', [
			{
				name: 'Kits',
				rows: [['Part Number', 'NIIN', null], ['KIT-100', NIIN[0], null], [null, NIIN[1], null], [null, NIIN[2], null], ['GSK-310', NIIN[3], null]],
				merges: ['B1:C1', 'A2:A4', 'B2:C2', 'B3:C3', 'B4:C4', 'B5:C5']
			}
		]);

		it('still fills the part down from its merge master', () => {
			expect(letters(workbook.analysis, 'Kits')).toEqual(['A', 'B']);
			for (const row of [2, 3, 4]) {
				const part = singleRecordAt(workbook.analysis, 'Kits', row).fields.part;
				expect(part, `row ${row}`).toMatchObject({ value: 'KIT-100', provenance: { cell: 'A2' } });
				expect(part?.provenance.transforms.includes('merge-fill'), `row ${row}`).toBe(row !== 2);
			}
			expect(workbook.analysis.summary.toImport).toBe(4);
		});
	});
});
