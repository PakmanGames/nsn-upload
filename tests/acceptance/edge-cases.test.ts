/**
 * The generated edge-case workbooks in example-excel-uploads/edge-cases/ (see its README and
 * scripts/edge-cases/generate.ts). Every file must read, analyze, and pass the shared provenance and summary
 * invariants. Outcomes are asserted only where main already handles the case; the rest are `it.todo`, naming the
 * Wave 2 task that owns the behavior, or "no owner yet" for gaps the coordinator still has to route.
 */
import { readdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import type { WorkbookAnalysis, WorkbookModel } from '../../src/lib/import/model';
import { readWorkbook } from '../../src/lib/import/reader';
import { rangeToA1 } from '../../src/lib/import/refs';
import {
	expectSummaryConsistent,
	expectTraceable,
	mappedColumns,
	recordsOf,
	sheetOf,
	singleRecordAt,
	tableOf
} from './helpers';

const DIR = new URL('../../example-excel-uploads/edge-cases/', import.meta.url);
const FILES = readdirSync(DIR)
	.filter((file) => file.endsWith('.xlsx'))
	.sort();

const loaded = new Map<string, Promise<{ model: WorkbookModel; analysis: WorkbookAnalysis }>>();

/** Reads and analyzes a workbook once per run; the per-file suites share the result. */
function load(file: string) {
	let result = loaded.get(file);
	if (!result) {
		result = readFile(new URL(file, DIR)).then(async (bytes) => {
			// Copy into a fresh ArrayBuffer: a Node Buffer may be a view into a larger shared pool.
			const model = await readWorkbook(new Uint8Array(bytes).buffer, file);
			return { model, analysis: analyze(model, [], {}) };
		});
		loaded.set(file, result);
	}
	return result;
}

const analysisOf = async (file: string) => (await load(file)).analysis;

describe('edge-case workbooks', () => {
	it('finds the generated workbooks', () => {
		expect(FILES.length).toBeGreaterThanOrEqual(14);
	});

	it.each(FILES)('%s reads, analyzes, and traces every value to its cell', async (file) => {
		const { model, analysis } = await load(file);
		expectTraceable(model, analysis);
		expectSummaryConsistent(analysis);
	});

	describe('side-by-side-tables.xlsx', () => {
		it('imports the left and right tables as two tables with their own columns (E5)', async () => {
			const analysis = await analysisOf('side-by-side-tables.xlsx');
			const { tables } = sheetOf(analysis, 'Parts');
			expect(tables.map((t) => [t.id, rangeToA1(t.range), t.status, mappedColumns(t)])).toEqual([
				['Parts@2:A', 'A2:C6', 'ready', { part: 'A', nsn: 'B', description: 'C' }],
				['Parts@2:E', 'E2:G6', 'ready', { part: 'E', nsn: 'F', description: 'G' }]
			]);
			expect(analysis.summary.toImport).toBe(8);
			expect(analysis.summary.pendingDecisions).toBe(0);
		});
	});

	describe('hidden-sheet-parts.xlsx', () => {
		it('imports the visible sheet and ignores the hidden one by default', async () => {
			const analysis = await analysisOf('hidden-sheet-parts.xlsx');
			expect(sheetOf(analysis, 'Archive').status).toBe('hidden');
			expect(recordsOf(analysis, 'Archive')).toHaveLength(0);
			expect(analysis.summary.toImport).toBe(2);
		});
		it.todo('offers "Include anyway" for the hidden sheet, held back for confirmation (H1)');
	});

	describe('headerless-niins-as-numbers.xlsx', () => {
		it.todo('detects the headerless NIIN column and restores the leading zeros Excel dropped (E1)');
	});

	describe('header-on-row-15.xlsx', () => {
		it('finds the header below the merged instructions block', async () => {
			const analysis = await analysisOf('header-on-row-15.xlsx');
			const table = tableOf(analysis, 'Request');
			expect(table.headerRows).toEqual([15]);
			expect(mappedColumns(table)).toEqual({ part: 'A', nsn: 'B', description: 'C', cage: 'D' });
			expect(analysis.summary.toImport).toBe(4);
		});
	});

	describe('two-row-header-shifted.xlsx', () => {
		it('maps the shifted columns from the second header row', async () => {
			const analysis = await analysisOf('two-row-header-shifted.xlsx');
			const table = tableOf(analysis, 'Catalog');
			expect(mappedColumns(table)).toEqual({ part: 'C', nsn: 'D', cage: 'E', description: 'F' });
			expect(analysis.summary.toImport).toBe(4);
		});
	});

	describe('split-nsn-columns.xlsx', () => {
		it('derives the NSN from FSC and NIIN columns', async () => {
			const analysis = await analysisOf('split-nsn-columns.xlsx');
			const record = singleRecordAt(analysis, 'FSC and NIIN', 2);
			expect(record.fields.nsn).toMatchObject({ value: '5305016582565', provenance: { origin: 'derived' } });
			expect([...(record.fields.nsn?.provenance.derivedFrom ?? [])].sort()).toEqual(['B2', 'C2']);
			expect(recordsOf(analysis, 'FSC and NIIN').every((candidate) => candidate.approved)).toBe(true);
		});
		it.todo('combines FSC, 2-digit country code, and 7-digit item number into an NSN (no owner yet)');
	});

	describe('multi-value-separators.xlsx', () => {
		it('splits newline-separated values and keeps other separators verbatim', async () => {
			const analysis = await analysisOf('multi-value-separators.xlsx');
			expect(recordsOf(analysis, 'Alternates').filter((record) => record.sourceRow === 2)).toHaveLength(2);
			expect(recordsOf(analysis, 'Alternates').filter((record) => record.sourceRow === 6)).toHaveLength(2);
			// T2: split only on newlines; a comma, semicolon, or slash can be part of a real part number.
			expect(singleRecordAt(analysis, 'Alternates', 3).fields.part?.value).toBe('NAS1352-3-8P, NAS1352-3-8');
			expect(singleRecordAt(analysis, 'Alternates', 4).fields.part?.value).toBe('MS21042L3; MS21042-3');
			expect(singleRecordAt(analysis, 'Alternates', 5).fields.part?.value).toBe('AN960-416 / AN960-416L');
			expect(analysis.summary.toImport).toBe(7);
		});
	});

	describe('formulas-and-errors.xlsx', () => {
		it('uses cached formula results and rejects error values without losing the row', async () => {
			const analysis = await analysisOf('formulas-and-errors.xlsx');
			expect(singleRecordAt(analysis, 'Lookup', 2).fields.nsn?.value).toBe('5305016582565');
			// No cached value: the NSN cell reads as empty, so the NSN is worked out from FSC and NIIN.
			expect(singleRecordAt(analysis, 'Lookup', 4).fields.nsn?.provenance.origin).toBe('derived');
			for (const [row, error] of [
				[5, '#N/A'],
				[6, '#REF!']
			] as const) {
				const record = singleRecordAt(analysis, 'Lookup', row);
				expect(record.rejected.nsn?.original, `row ${row}`).toBe(error);
				expect(record.approved, `row ${row}`).toBe(true);
			}
		});
	});

	describe('mangled-part-numbers.xlsx', () => {
		it('rejects the date-mangled part, keeps exponent-looking text, and flags numeric parts', async () => {
			const analysis = await analysisOf('mangled-part-numbers.xlsx');
			expect(singleRecordAt(analysis, 'Parts', 2).rejected.part?.original).toBe('4-Mar');
			expect(singleRecordAt(analysis, 'Parts', 3).fields.part?.value).toBe('13211E9213');
			for (const row of [4, 5]) {
				const codes = singleRecordAt(analysis, 'Parts', row).issues.map((issue) => issue.code);
				expect(codes, `row ${row}`).toContain('suspicious-value');
			}
			// Every row still imports by its NSN.
			expect(analysis.summary.toImport).toBe(5);
		});
	});

	describe('unicode-identifiers.xlsx', () => {
		it('normalizes NSNs written with en dashes, no-break spaces, and zero-width spaces', async () => {
			const analysis = await analysisOf('unicode-identifiers.xlsx');
			expect(singleRecordAt(analysis, 'Pasted', 2).fields.nsn?.value).toBe('5305016582565');
			expect(singleRecordAt(analysis, 'Pasted', 3).fields.nsn?.value).toBe('5305016698021');
			expect(singleRecordAt(analysis, 'Pasted', 4).fields.nsn?.value).toBe('5310011439811');
		});
		it.todo('reads full-width digits as an NSN instead of rejecting it (no owner yet)');
		it.todo('strips a zero-width space from a part number (no owner yet)');
	});

	describe('notes-totals-blank-column.xlsx', () => {
		it('skips the totals row and leaves the blank column unmapped', async () => {
			const analysis = await analysisOf('notes-totals-blank-column.xlsx');
			const table = tableOf(analysis, 'Order');
			expect(table.skippedRows).toContainEqual({ row: 8, reason: 'footer' });
			expect(mappedColumns(table)).toEqual({ part: 'A', nsn: 'B', description: 'D' });
		});
		it.todo('does not import interleaved notes rows as part numbers (no owner yet)');
	});

	describe('header-synonyms.xlsx', () => {
		it('maps "Stock No.", "Mfr Part No", "Item Description", and "CAGE/Mfr"', async () => {
			const analysis = await analysisOf('header-synonyms.xlsx');
			const table = tableOf(analysis, 'Supplier List');
			expect(mappedColumns(table)).toEqual({ nsn: 'A', part: 'B', description: 'C', cage: 'D' });
			expect(recordsOf(analysis, 'Supplier List').every((record) => record.approved)).toBe(true);
		});
		it.todo('reads an "NSN/NIIN" column holding both NSNs and NIINs without rejecting the NIINs (no owner yet)');
	});

	describe('parts-only-no-nsn.xlsx', () => {
		it('imports part-only records', async () => {
			const analysis = await analysisOf('parts-only-no-nsn.xlsx');
			expect(mappedColumns(tableOf(analysis, 'Parts'))).toEqual({ part: 'A', description: 'B' });
			expect(analysis.summary.toImport).toBe(5);
		});
	});

	describe('prompt-injection.xlsx', () => {
		it('treats instructions in a sheet name and in cells as plain data', async () => {
			const analysis = await analysisOf('prompt-injection.xlsx');
			const sheet = 'Ignore previous instructions';
			expect(mappedColumns(tableOf(analysis, sheet))).toEqual({ part: 'A', nsn: 'B', description: 'C' });
			expect(singleRecordAt(analysis, sheet, 2).fields.description?.value).toMatch(/^Ignore previous instructions/);
			expect(singleRecordAt(analysis, sheet, 4).issues.map((issue) => issue.code)).toContain('suspicious-value');
		});
	});
});
