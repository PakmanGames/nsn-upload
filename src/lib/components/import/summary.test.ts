import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import type { Decision, Overrides, SheetAnalysis, SheetStatus, WorkbookAnalysis, WorkbookModel } from '$lib/import/model';
import { readWorkbook } from '$lib/import/reader';
import { buildMockAnalysis } from './mock-analysis';
import {
	columnsOpenByDefault,
	columnsSummary,
	rowsSummary,
	sheetsSummary,
	statusChips,
	summarySentence,
	worthALook
} from './summary';

const WOW = 'WOW NSN list 7-20-26 (2).xlsx';
const STATZ = 'Statz - List of active Geier and Bluhm parts listed on the NSN listings (1).xlsx';
const PENCOM = 'PENCOM_Government_Procurement_Database (2).xlsx';

const models = new Map<string, WorkbookModel>();
beforeAll(async () => {
	for (const file of [WOW, STATZ, PENCOM]) {
		const bytes = readFileSync(resolve('example-excel-uploads', file));
		models.set(file, await readWorkbook(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength), file));
	}
});
const fixture = (file: string, overrides: Overrides = {}) => analyze(models.get(file)!, [], overrides);
const acceptAll = (analysis: WorkbookAnalysis): Overrides => ({
	decisions: Object.fromEntries(analysis.decisions.filter((d) => d.state === 'pending').map((d) => [d.id, d.suggested]))
});

/** Just enough of an analysis for the sentence: sheet statuses, row and record counts, pending decisions. */
function shape(statuses: SheetStatus[], sourceRows: number, candidates: number, pendingDecisions = 0): WorkbookAnalysis {
	const sheets = statuses.map((status, index): SheetAnalysis => ({ name: `S${index}`, index, status, reasons: [], tables: [], aiTrigger: null }));
	const summary = { ...buildMockAnalysis().summary, sourceRows, candidates, pendingDecisions };
	return { fileName: 'x.xlsx', sheets, records: [], decisions: [], summary };
}

describe('R1 summary sentence', () => {
	it('reads the example files', () => {
		expect(summarySentence(fixture(WOW))).toBe('1 of 2 sheets has an importable table · 179 rows → 180 records · nothing needs you');
		expect(summarySentence(fixture(STATZ))).toBe('1 of 1 sheet has an importable table · 54 rows · nothing needs you');
		expect(summarySentence(fixture(PENCOM))).toBe('2 of 6 sheets have importable tables · 7 rows · 3 decisions need you');
	});

	it('agrees in number and leaves out records when they match the rows', () => {
		expect(summarySentence(shape(['ready', 'ready'], 1, 1, 1))).toBe(
			'2 of 2 sheets have importable tables · 1 row · 1 decision needs you'
		);
		expect(summarySentence(shape(['no-table'], 0, 0))).toBe('0 of 1 sheet has an importable table · 0 rows · nothing needs you');
		expect(summarySentence(shape(['no-table', 'hidden', 'needs-review'], 5, 5))).toBe(
			'0 of 3 sheets have importable tables · 5 rows · nothing needs you'
		);
		expect(summarySentence(shape(['ready', 'hidden', 'no-table'], 3, 4, 2))).toBe(
			'1 of 3 sheets has an importable table · 3 rows → 4 records · 2 decisions need you'
		);
	});
});

describe('R2 chips and R6 rows summary', () => {
	it('shows only non-zero counts', () => {
		expect(statusChips(fixture(WOW)).map((chip) => chip.label)).toEqual(['176 valid', '4 warnings', '2 split from D136']);
		expect(statusChips(fixture(STATZ)).map((chip) => chip.label)).toEqual(['45 valid', '9 warnings']);
	});

	it('counts held-back tables apart instead of as warnings', () => {
		const pencom = fixture(PENCOM);
		expect(statusChips(pencom).map((chip) => [chip.label, chip.filter])).toEqual([
			['4 in conflict', 'conflict'],
			['3 held back', 'all']
		]);
		expect(rowsSummary(pencom)).toBe('4 records · 4 in conflict · 3 held back');
		expect(rowsSummary(fixture(WOW))).toBe('180 records · 4 warnings · 2 split from D136');
	});
});

describe('R4 and R5 section summaries', () => {
	it('summarizes sheets by status, leaving out zero counts', () => {
		expect(sheetsSummary(fixture(PENCOM).sheets)).toBe('2 ready · 1 needs review · 3 nothing to import');
		expect(sheetsSummary(fixture(WOW).sheets)).toBe('1 ready · 1 hidden');
	});

	it('lists mapped fields per included table, in column order', () => {
		expect(columnsSummary(fixture(WOW))).toBe('Part number, NSN, Description');
		expect(columnsSummary(fixture(PENCOM))).toBe(
			'NSN Cross-Reference: NSN, FSC, NIIN, Description, Part number, CAGE · Part Number Intake: Part number, Description, NSN, FSC'
		);
	});

	it('opens Columns only for an uncertain mapping of an included table or a user remap', () => {
		expect(columnsOpenByDefault(fixture(WOW))).toBe(false);
		expect(columnsOpenByDefault(fixture(STATZ))).toBe(false);
		// Search Log's medium-confidence columns do not count while the table is held back.
		const pencom = fixture(PENCOM);
		expect(columnsOpenByDefault(pencom)).toBe(false);
		const searchLog = pencom.decisions.find((d: Decision) => d.kind === 'include-table' && d.tableId?.startsWith('Search Log'))!;
		expect(columnsOpenByDefault(fixture(PENCOM, { decisions: { [searchLog.id]: 'include' } }))).toBe(true);
		expect(columnsOpenByDefault(fixture(WOW, { columns: { 'Active Parts@1': { 6: null } } }))).toBe(true);
	});
});

describe('R9 worth a look', () => {
	it('groups the warnings of the example files by issue code', () => {
		expect(worthALook(fixture(WOW))).toEqual([
			{
				title: '2 rows had a malformed NSN',
				detail: 'rows 134 and 166; the part number imports, the bad NSN does not'
			},
			{ title: '1 part number has a note in brackets', detail: 'row 43, kept as written' },
			{ title: '1 record has no description', detail: 'row 180' }
		]);
		expect(worthALook(fixture(STATZ))).toEqual([
			{ title: '9 records list the same item under different NSNs', detail: 'at most one NSN per item is current' }
		]);
	});

	it('says nothing for held-back or warning-free files', () => {
		expect(worthALook(fixture(PENCOM))).toEqual([]);
		expect(worthALook(fixture(PENCOM, acceptAll(fixture(PENCOM))))).toEqual([]);
	});

	it('shortens long row lists and names numbers stored as numbers', () => {
		const lines = worthALook(buildMockAnalysis()).map((line) => `${line.title} · ${line.detail}`);
		expect(lines).toContain('3 rows had a malformed NSN · rows 120, 134 and 166; the part number imports, the bad NSN does not');
		expect(lines).toContain('1 part number was stored as a number · row 5; leading zeros may have been lost');
		expect(lines).toContain('5 records list the same item under different NSNs · at most one NSN per item is current');
	});
});
