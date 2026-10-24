/**
 * Shared plumbing for the acceptance suites: real bytes in, a full analyze() out, and the invariants every
 * workbook must satisfy. Nothing here knows about a specific fixture.
 */
import { readFile } from 'node:fs/promises';
import ExcelJS from 'exceljs';
import { beforeAll, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import {
	decisionId,
	type CandidateRecord,
	type Field,
	type Overrides,
	type SheetAnalysis,
	type StoredMapping,
	type TableCandidate,
	type WorkbookAnalysis,
	type WorkbookModel
} from '../../src/lib/import/model';
import { colLetter, parseA1, toA1 } from '../../src/lib/import/refs';
import { readWorkbook } from '../../src/lib/import/reader';

/** Real-shaped NSNs (FSC + NIIN) for synthetic workbooks, written with hyphens the way users paste them. */
export const NSN = ['5305-01-658-2565', '5305-01-669-8021', '5340-01-102-4535', '3020-01-660-9619', '2530-00-967-3346'];

export const digits = (nsn: string) => nsn.replace(/-/g, '');

const FIXTURE_DIR = new URL('../../example-excel-uploads/', import.meta.url);

export async function loadFixture(file: string): Promise<WorkbookModel> {
	const bytes = await readFile(new URL(encodeURIComponent(file), FIXTURE_DIR));
	// Copy into a fresh ArrayBuffer: a Node Buffer may be a view into a larger shared pool.
	return readWorkbook(new Uint8Array(bytes).buffer, file);
}

export type SheetSpec = {
	name: string;
	/**
	 * rows[0] is Excel row 1; null leaves a cell empty. Besides strings and numbers, ExcelJS values cover dates,
	 * `{ formula, result }` (a cached result Excel would store), and `{ error: '#N/A' }`.
	 */
	rows: Array<Array<ExcelJS.CellValue>>;
	merges?: string[];
	state?: 'visible' | 'hidden' | 'veryHidden';
	/** A1 ref -> number format, e.g. a date format on a number. */
	numFmts?: Record<string, string>;
	/** 1-based rows hidden in Excel, as a filter leaves them. */
	hiddenRows?: number[];
};

/**
 * Writes a real .xlsx with ExcelJS and reads it back through readWorkbook().
 * ExcelJS is a different writer than the fixtures' (.NET Open XML SDK, Excel), so the reader is not tested
 * only against the files it was developed on.
 */
export async function buildWorkbook(fileName: string, sheets: SheetSpec[]): Promise<WorkbookModel> {
	const workbook = new ExcelJS.Workbook();
	for (const spec of sheets) {
		const sheet = workbook.addWorksheet(spec.name, { state: spec.state ?? 'visible' });
		spec.rows.forEach((values, index) => {
			values.forEach((value, col) => {
				if (value !== null) sheet.getCell(index + 1, col + 1).value = value;
			});
		});
		for (const range of spec.merges ?? []) sheet.mergeCells(range);
		for (const [ref, format] of Object.entries(spec.numFmts ?? {})) sheet.getCell(ref).numFmt = format;
		for (const row of spec.hiddenRows ?? []) sheet.getRow(row).hidden = true;
	}
	const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
	return readWorkbook(bytes.buffer, fileName);
}

/**
 * Builds the workbook once for the enclosing describe block and checks the provenance and summary contracts on it.
 * The returned object is filled in by beforeAll, so read it inside tests only.
 */
export function useWorkbook(fileName: string, sheets: SheetSpec[], existing: StoredMapping[] = []) {
	const context = {} as { model: WorkbookModel; analysis: WorkbookAnalysis };
	beforeAll(async () => {
		context.model = await buildWorkbook(fileName, sheets);
		context.analysis = analyze(context.model, existing, {});
	});
	it('traces every value to the cell that holds its original text', () => {
		expectTraceable(context.model, context.analysis);
		expectSummaryConsistent(context.analysis);
	});
	return context;
}

/** What "Accept all suggestions" does: every pending decision takes its suggested option, in one pass. */
export function acceptAllSuggestions(analysis: WorkbookAnalysis, overrides: Overrides = {}): Overrides {
	const accepted = analysis.decisions
		.filter((decision) => decision.state === 'pending')
		.map((decision) => [decision.id, decision.suggested]);
	return { ...overrides, decisions: { ...overrides.decisions, ...Object.fromEntries(accepted) } };
}

export function sheetOf(analysis: WorkbookAnalysis, name: string): SheetAnalysis {
	const sheet = analysis.sheets.find((candidate) => candidate.name === name);
	if (!sheet) throw new Error(`No sheet "${name}" in the analysis`);
	return sheet;
}

/** The single table on a sheet (the 5-hour scope has at most one). */
export function tableOf(analysis: WorkbookAnalysis, sheetName: string): TableCandidate {
	const { tables } = sheetOf(analysis, sheetName);
	expect(tables, `tables on "${sheetName}"`).toHaveLength(1);
	return tables[0];
}

export function recordsOf(analysis: WorkbookAnalysis, sheetName: string): CandidateRecord[] {
	return analysis.records.filter((record) => record.sheet === sheetName);
}

export function recordAt(analysis: WorkbookAnalysis, sheetName: string, row: number): CandidateRecord[] {
	return recordsOf(analysis, sheetName).filter((record) => record.sourceRow === row);
}

/** The one record built from a source row that was not split. */
export function singleRecordAt(analysis: WorkbookAnalysis, sheetName: string, row: number): CandidateRecord {
	const records = recordAt(analysis, sheetName, row);
	expect(records, `records from ${sheetName} row ${row}`).toHaveLength(1);
	return records[0];
}

/** Mapped columns as field -> column letter, the shape the expectations use. */
export function mappedColumns(table: TableCandidate): Partial<Record<Field, string>> {
	return Object.fromEntries(
		table.columns.flatMap((column) => (column.field ? [[column.field, colLetter(column.col)]] : []))
	);
}

/** Sort comparator for import inputs, whose order the plan does not promise. */
export function byPart(a: { part?: string }, b: { part?: string }): number {
	return (a.part ?? '').localeCompare(b.part ?? '');
}

/** "D" -> 4. */
export function colOf(letter: string): number {
	const at = parseA1(`${letter}1`);
	if (!at) throw new Error(`Invalid column letter "${letter}"`);
	return at.col;
}

/**
 * The provenance contract: every source value names the cell that holds its original text, and every derived
 * value names cells that exist. A wrong row or column here would make the review window point users at the
 * wrong place in Excel, so it is checked on every workbook rather than on a few examples.
 */
export function expectTraceable(model: WorkbookModel, analysis: WorkbookAnalysis): void {
	const sheets = new Map(model.sheets.map((sheet) => [sheet.name, sheet]));
	const byId = new Map(analysis.records.map((record) => [record.id, record]));
	for (const record of analysis.records) {
		// A merged record also carries fields of the records folded into it; those keep their own sheet and row.
		const folded = (record.mergedFrom ?? []).flatMap((id) => byId.get(id) ?? []);
		const origins = new Set([record, ...folded].map(({ sheet, sourceRow }) => `${sheet}!${sourceRow}`));
		for (const [field, value] of Object.entries(record.fields)) {
			if (!value) continue;
			const { provenance } = value;
			const where = `${record.id} ${field}`;
			const sheet = sheets.get(provenance.sheet);
			expect(provenance.file, where).toBe(model.fileName);
			expect(sheet, `${where} sheet "${provenance.sheet}"`).toBeDefined();
			if (!sheet) continue;
			if (provenance.origin === 'derived') {
				expect(provenance.derivedFrom?.length, `${where} derivedFrom`).toBeGreaterThan(0);
				for (const ref of provenance.derivedFrom ?? []) {
					const at = parseA1(ref);
					expect(at, `${where} derivedFrom ${ref}`).not.toBeNull();
					if (at) expect(sheet.cell(at.row, at.col).kind, `${where} ${ref}`).not.toBe('empty');
				}
				continue;
			}
			const at = parseA1(provenance.cell);
			expect(at, `${where} cell ${provenance.cell}`).not.toBeNull();
			if (at) expect(sheet.cell(at.row, at.col).text, `${where} at ${provenance.cell}`).toBe(provenance.original);
			// A merge-filled value points at the merge master, which sits on another row by definition.
			if (!provenance.transforms.includes('merge-fill')) {
				expect(toA1(provenance.row, provenance.col), where).toBe(provenance.cell);
				expect([...origins], where).toContain(`${provenance.sheet}!${provenance.row}`);
			}
		}
		const sheet = sheets.get(record.sheet);
		expect(sheet, `sheet of ${record.id}`).toBeDefined();
		if (!sheet) continue;
		for (const [field, rejected] of Object.entries(record.rejected)) {
			if (!rejected) continue;
			// A plain A1 ref, like Provenance.cell; parseA1 rejects a sheet-qualified one.
			const at = parseA1(rejected.cell);
			const where = `${record.id} rejected ${field}`;
			expect(at, `${where} cell ${rejected.cell}`).not.toBeNull();
			if (!at) continue;
			// An error cell has no text; its rejected original is the error code Excel shows.
			const cell = sheet.cell(at.row, at.col);
			expect(cell.kind === 'error' ? cell.raw : cell.text, where).toBe(rejected.original);
		}
	}
}

/**
 * Summary counts must agree with the records and decisions they summarize, or the UI chips lie.
 * Counts cover included and pending tables (T5): an excluded table's records stay in `records`, unapproved,
 * so the table can be re-included, but they are not counted.
 */
export function expectSummaryConsistent(analysis: WorkbookAnalysis): void {
	const { summary, records, decisions } = analysis;
	const tableDecisions = decisions.filter((decision) => decision.kind === 'include-table');
	const excluded = new Set(
		tableDecisions.filter((decision) => decision.chosen === 'exclude').map((decision) => decision.id)
	);
	const counted = records.filter((record) => !excluded.has(decisionId('include-table', record.tableId)));
	const withStatus = (status: CandidateRecord['status']) => counted.filter((record) => record.status === status).length;

	// Every sheet counts, hidden ones included.
	expect(summary.sheets, 'summary.sheets').toBe(analysis.sheets.length);
	expect(summary.candidates, 'summary.candidates').toBe(counted.length);
	expect(summary.splitRecords, 'summary.splitRecords').toBe(counted.filter((record) => record.split).length);
	expect(summary.valid, 'summary.valid').toBe(withStatus('valid'));
	expect(summary.warnings, 'summary.warnings').toBe(withStatus('warning'));
	expect(summary.invalid, 'summary.invalid').toBe(withStatus('invalid'));
	expect(summary.duplicates, 'summary.duplicates').toBe(withStatus('duplicate'));
	expect(summary.conflicts, 'summary.conflicts').toBe(withStatus('conflict'));
	expect(summary.sourceRows, 'summary.sourceRows').toBe(
		new Set(counted.map((record) => `${record.tableId}:${record.sourceRow}`)).size
	);
	// Tables the user set up by hand are included without a decision.
	const handMade = analysis.sheets.flatMap((sheet) => sheet.tables).filter((table) => table.source === 'user');
	expect(summary.tablesIncluded, 'summary.tablesIncluded').toBe(
		tableDecisions.filter((decision) => decision.chosen === 'include').length + handMade.length
	);
	expect(summary.toImport, 'summary.toImport').toBe(records.filter((record) => record.approved).length);
	expect(summary.pendingDecisions, 'summary.pendingDecisions').toBe(
		decisions.filter((decision) => decision.state === 'pending').length
	);
}
