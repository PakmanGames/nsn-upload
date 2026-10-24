import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '$lib/import/analyze';
import type { Decision, Overrides, SheetAnalysis, SheetStatus, StoredMapping, WorkbookAnalysis, WorkbookModel } from '$lib/import/model';
import { readWorkbook } from '$lib/import/reader';
import { makeSheet, makeWorkbook } from '$lib/import/testing';
import { buildMockAnalysis } from './mock-analysis';
import {
	columnsOpenByDefault,
	columnsSummary,
	nothingToImport,
	partColumnChoices,
	rowsSummary,
	rowsTitle,
	setupSheets,
	sheetsSummary,
	statusChips,
	summaryParts,
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
	const summary = { ...buildMockAnalysis().summary, sourceRows, candidates, pendingDecisions, toImport: candidates };
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
		expect(summarySentence(shape(['no-table'], 0, 0))).toBe('0 of 1 sheet has an importable table · 0 rows · nothing will import');
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
		expect(rowsSummary(pencom)).toBe('4 records · 4 in conflict');
		expect(rowsSummary(fixture(WOW))).toBe('180 records · 4 warnings · 2 split from D136');
	});

	it('titles Rows with the sentence row count and held-back rows apart', () => {
		const pencom = fixture(PENCOM);
		expect(rowsTitle(pencom)).toBe('Rows (7) · 3 held back');
		// Excluding Search Log drops its rows from the sentence ("4 rows"); the title follows and still names them.
		const excluded = fixture(PENCOM, acceptAll(pencom));
		expect(summarySentence(excluded)).toContain(' · 4 rows · ');
		expect(rowsTitle(excluded)).toBe('Rows (4) · 3 held back');
		expect(rowsTitle(fixture(WOW))).toBe('Rows (179)');
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

	it('opens Columns and offers both columns when two could hold part numbers and neither is mapped', () => {
		const tie = makeWorkbook('tie.xlsx', [
			makeSheet('Parts', [
				['Item', 'Drawing', 'NSN'],
				['02-15784', 'MS35106-1', '4330-01-320-0968'],
				['03W2504-164', '12297933', '5310-01-580-7835'],
				['130909B190', 'SM-A-802914', '5306-01-482-8472'],
				['131554-4F', '457985-1 B', '5340-01-482-2716']
			])
		]);
		const analysis = analyze(tie, []);
		const [table] = analysis.sheets[0].tables;
		expect(partColumnChoices(table).map((column) => column.header)).toEqual(['Item', 'Drawing']);
		expect(columnsOpenByDefault(analysis)).toBe(true);
		// The rows still import, but the open choice is not "nothing needs you".
		expect(summarySentence(analysis)).toBe('1 of 1 sheet has an importable table · 4 rows · pick the part number column');
		expect(summaryParts(analysis).done).toBe(false);

		// Picking one maps it, which ends the choice.
		const picked = analyze(tie, [], { columns: { [table.id]: { 1: 'part' } } });
		expect(partColumnChoices(picked.sheets[0].tables[0])).toEqual([]);
		// A single candidate beside a mapped Part column is only a suggestion in its picker.
		expect(partColumnChoices(fixture(STATZ).sheets[0].tables[0])).toEqual([]);
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

	it('leaves out a row the user unchecked, since the line says these rows still import', () => {
		const annotated = fixture(WOW).records.find((record) => record.sourceRow === 43)!;
		expect(worthALook(fixture(WOW, { excludedRecords: [annotated.id] })).map((line) => line.title)).toEqual([
			'2 rows had a malformed NSN',
			'1 record has no description'
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

describe('nothing to import', () => {
	const nsns = ['5305-01-658-2565', '5305-01-669-8021', '5340-01-102-4535', '3020-01-660-9619'];
	const parts = (rows: string[][]) => makeSheet('Parts', [['Part Number', 'NSN'], ...rows]);
	const run = (sheets: ReturnType<typeof makeSheet>[], overrides: Overrides = {}, existing: StoredMapping[] = []) => {
		const model = makeWorkbook('x.xlsx', sheets);
		return { model, analysis: analyze(model, existing, overrides) };
	};

	it('says nothing and shows done when something will import', () => {
		const { model, analysis } = run([parts([['SE5826', nsns[0]]])]);
		expect(nothingToImport(analysis, model, true)).toBeNull();
		expect(summaryParts(analysis)).toMatchObject({ needs: 'nothing needs you', done: true });
	});

	it('points at the decision and offers to set the table up by hand while a found table waits', () => {
		const { model, analysis } = run([makeSheet('List', nsns.map((nsn) => [nsn]))]);
		expect(summaryParts(analysis)).toMatchObject({ needs: '1 decision needs you', done: false });
		expect(nothingToImport(analysis, model, true)).toEqual({
			reason: 'Nothing will import until you make the decision below',
			steps: ['set-up'],
			setupSheet: 'List'
		});
	});

	it('offers the setup, and AI only when it could help and can be turned on, when no table was found', () => {
		const notes = makeSheet('Notes', [['Seen on the listing'], ...nsns.slice(0, 3).map((nsn, i) => [...Array(i).fill(null), nsn])]);
		const { model, analysis } = run([makeSheet('Cover', [['Quote request']]), notes]);
		expect(summaryParts(analysis)).toMatchObject({ needs: 'nothing will import', done: false });
		expect(nothingToImport(analysis, model, true)).toEqual({
			reason: 'We could not find a table on any sheet',
			steps: ['set-up', 'ai'],
			// The sheet with NSN-like cells comes before the cover sheet.
			setupSheet: 'Notes'
		});
		expect(nothingToImport(analysis, model, false)?.steps).toEqual(['set-up']);
	});

	it('explains an empty or hidden workbook without offering a setup', () => {
		const empty = run([makeSheet('Sheet1', [])]);
		expect(nothingToImport(empty.analysis, empty.model, true)).toEqual({ reason: 'The visible sheets are empty', steps: [], setupSheet: null });
		const hidden = run([makeSheet('Data', [['NSN'], [nsns[0]]], { visibility: 'hidden' })]);
		expect(nothingToImport(hidden.analysis, hidden.model, true)?.reason).toBe('Every sheet in this workbook is hidden');
	});

	it('names the user’s choice when every table was left out', () => {
		const { model, analysis } = run([parts([['SE5826', nsns[0]]])], { decisions: { 'include-table:Parts@1': 'exclude' } });
		expect(nothingToImport(analysis, model, true)).toEqual({
			reason: 'You left the only table out',
			steps: ['sheets', 'set-up'],
			setupSheet: 'Parts'
		});
	});

	it('says why no record of an included table imports', () => {
		const saved: StoredMapping[] = [{ id: 's1', part: 'SE5826', nsn: '5305016582565' }];
		const duplicates = run([parts([['SE5826', nsns[0]]])], {}, saved);
		expect(nothingToImport(duplicates.analysis, duplicates.model, true)).toEqual({
			reason: 'No record can be imported: 1 is a duplicate',
			steps: ['rows'],
			setupSheet: null
		});
		const unchecked = run([parts([['SE5826', nsns[0]], ['RC 620', nsns[1]]])], { excludedRecords: ['Parts@1:r2', 'Parts@1:r3'] });
		expect(nothingToImport(unchecked.analysis, unchecked.model, true)?.reason).toBe(
			'No record can be imported: 2 were left out by you'
		);
	});

	it('lists the sheets a table can be set up on, likeliest first', () => {
		const ready = parts([['SE5826', nsns[0]]]);
		const list = makeSheet('List', nsns.map((nsn) => [nsn]));
		const cover = makeSheet('Cover', [['Quote request']]);
		const empty = makeSheet('Empty', []);
		const { model, analysis } = run([cover, ready, empty, list]);
		expect(setupSheets(analysis.sheets, analysis.decisions, model)).toEqual(['List', 'Cover']);

		const manual = { headerRows: [], range: { top: 1, left: 1, bottom: 4, right: 1 }, columns: { 1: 'nsn' as const } };
		const setUp = run([cover, ready, empty, list], { manualTables: [{ ...manual, sheet: 'List' }] });
		expect(setupSheets(setUp.analysis.sheets, setUp.analysis.decisions, setUp.model)).toEqual(['Cover']);
	});
});
