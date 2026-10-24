/**
 * M1: plain-language explanations on the real workbooks. One test per decision kind and issue code pins the
 * wording on a real case, and a scan holds every explanation the fixtures produce to the copy rules (no
 * `Sheet!A1` refs, no unhyphenated NSNs, no importer jargon) and to the AI verifier, so the rules wording
 * is always a valid fallback for the AI wording.
 */
import { readFile } from 'node:fs/promises';
import { beforeAll, describe, expect, it } from 'vitest';
import { boundedItem } from '../../src/lib/import/ai/explain-schema';
import { verifyExplanations } from '../../src/lib/import/ai/explain-verify';
import { analyze } from '../../src/lib/import/analyze';
import {
	copyProblems,
	explainColumn,
	explainDecision,
	explainIssue,
	explainSheetWithoutTable,
	recordLabel,
	tableNotes,
	type Explanation
} from '../../src/lib/import/explain';
import type { CandidateRecord, Decision, DecisionKind, IssueCode, StoredMapping, WorkbookAnalysis, WorkbookModel } from '../../src/lib/import/model';
import { readWorkbook } from '../../src/lib/import/reader';
import { pencom, statz, wow } from '../fixtures/expectations';
import { NSN, acceptAllSuggestions, buildWorkbook, loadFixture, recordAt, sheetOf, singleRecordAt, tableOf } from './helpers';

const SUBSTRING = 'Substring Headers in Diff Sheet (1).xlsx';
const SHIFTED = 'ShiftedTable.xlsx';
const MERGED = 'Merged Column, FSC + NIIN NSN Tests (1).xlsx';
const JUST_NSNS = 'Just NSNs (1).xlsx';
const FIXTURE_FILES = [wow.file, statz.file, pencom.file, SUBSTRING, SHIFTED, MERGED, JUST_NSNS];
const DEMOS = ['a-ai-unfamiliar-header.xlsx', 'b-identifier-conflict.xlsx', 'c-pencom-changed-copy.xlsx', 'd-messy-showcase.xlsx'];

const SUBSTRING_SHEET = 'T6 Consumable Parts Matching';
/** The PENCOM records as "Accept all suggestions" imports them, saved in the browser. */
const SAVED_PENCOM: StoredMapping[] = pencom.imported.map((input, i) => ({ ...input, id: `saved-${i + 1}` }));

async function loadDemo(file: string): Promise<WorkbookModel> {
	const bytes = await readFile(new URL(`../../docs/demo-workbooks/${file}`, import.meta.url));
	return readWorkbook(new Uint8Array(bytes).buffer, file);
}

const text = ({ headline, body }: Explanation) => ({ headline, body });

function decisionOf(analysis: WorkbookAnalysis, kind: DecisionKind, recordId?: string): Decision {
	const decision = analysis.decisions.find(
		(candidate) => candidate.kind === kind && (!recordId || candidate.recordIds.includes(recordId))
	);
	if (!decision) throw new Error(`No ${kind} decision${recordId ? ` for ${recordId}` : ''}`);
	return decision;
}

function issueText(analysis: WorkbookAnalysis, record: CandidateRecord, code: IssueCode, saved: StoredMapping[] = []) {
	const issue = record.issues.find((candidate) => candidate.code === code);
	if (!issue) throw new Error(`No ${code} issue on ${record.id}`);
	return text(explainIssue(issue, record, analysis, saved));
}

type Loaded = { name: string; model: WorkbookModel; saved: StoredMapping[]; analyses: WorkbookAnalysis[] };

const loaded: Loaded[] = [];
const byName = (name: string) => loaded.find((entry) => entry.name === name)!;
const initial = (name: string) => byName(name).analyses[0];

beforeAll(async () => {
	const sources = [
		...FIXTURE_FILES.map(async (file) => ({ name: file, model: await loadFixture(file), saved: [] as StoredMapping[] })),
		...DEMOS.map(async (file) => ({ name: file, model: await loadDemo(file), saved: file.startsWith('c-') ? SAVED_PENCOM : [] })),
		// PENCOM uploaded again on top of its own import: storage duplicates.
		loadFixture(pencom.file).then((model) => ({ name: 'pencom-again', model, saved: SAVED_PENCOM }))
	];
	for (const { name, model, saved } of await Promise.all(sources)) {
		const first = analyze(model, saved, {});
		loaded.push({ name, model, saved, analyses: [first, analyze(model, saved, acceptAllSuggestions(first))] });
	}
});

describe('every explanation the workbooks produce', () => {
	/** Every decision and issue explanation, initially and after "Accept all suggestions", with what to check it against. */
	function* everything() {
		for (const { name, saved, analyses } of loaded) {
			for (const analysis of analyses) {
				for (const decision of analysis.decisions) {
					yield { where: `${name}: ${decision.id}`, explanation: explainDecision(decision, analysis, saved), decision };
				}
				for (const record of analysis.records) {
					for (const issue of record.issues) {
						yield { where: `${name}: ${record.id} ${issue.code}`, explanation: explainIssue(issue, record, analysis, saved) };
					}
				}
			}
		}
	}

	it('covers every decision kind and issue code', () => {
		const kinds = new Set<string>();
		const codes = new Set<string>();
		for (const { analyses } of loaded) {
			for (const analysis of analyses) {
				analysis.decisions.forEach((decision) => kinds.add(decision.kind));
				analysis.records.forEach((record) => record.issues.forEach((issue) => codes.add(issue.code)));
			}
		}
		// The rest are covered by the synthetic workbooks below.
		expect([...kinds].sort()).toEqual([
			'drop-duplicate',
			'import-valid-portion',
			'include-table',
			'resolve-conflict',
			'resolve-identifier-conflict',
			'resolve-storage-conflict',
			'split-cell'
		]);
		expect(codes.size).toBeGreaterThanOrEqual(9);
	});

	it('follows the copy rules: no sheet-qualified cells, no unhyphenated NSNs, no importer jargon', () => {
		const broken = [...everything()].flatMap(({ where, explanation }) => {
			const problems = copyProblems(`${explanation.headline}\n${explanation.body}`, explanation.facts);
			return problems.length ? [`${where}: ${problems.join(', ')}`] : [];
		});
		expect(broken).toEqual([]);
	});

	it('writes NSN facts with hyphens and keeps headlines short', () => {
		for (const { where, explanation } of everything()) {
			for (const fact of explanation.facts.filter((candidate) => /\bNSN\b/.test(candidate.label))) {
				expect(fact.value, where).not.toMatch(/^\d{13}$/);
			}
			expect(explanation.headline.length, `${where}: ${explanation.headline}`).toBeLessThanOrEqual(64);
			expect(explanation.body, where).not.toBe('');
		}
	});

	it('cites every cell and long number it mentions, so it passes the AI verifier as its own rewording', () => {
		const items = [...everything()].flatMap(({ explanation, decision }, i) =>
			decision
				? [{ ...boundedItem(`d${i}`, decision.kind, explanation.facts, explanation), options: decision.options.map((option) => option.label) }]
				: []
		);
		const response = { items: items.map(({ id, plain }) => ({ id, ...plain })) };
		expect(verifyExplanations(items, response).rejected).toEqual([]);
	});

	it('never states the suggestion: the decision card shows it on its own', () => {
		for (const { where, explanation } of everything()) {
			expect(`${explanation.headline} ${explanation.body}`, where).not.toMatch(/suggest|recommend/i);
		}
	});
});

describe('decision templates on real cases', () => {
	it('identifier conflict, Substring row 49: the NSN starts with another FSC', () => {
		const analysis = initial(SUBSTRING);
		const [record] = recordAt(analysis, SUBSTRING_SHEET, 49);
		const explanation = explainDecision(decisionOf(analysis, 'resolve-identifier-conflict', record.id), analysis);
		expect(text(explanation)).toEqual({
			headline: "The FSC doesn't match this NSN",
			body: "An NSN starts with its 4-digit FSC. B49's NSN 6850-01-494-9650 starts with 6850, but E49 says 8030."
		});
		expect(explanation.facts).toEqual([
			{ label: 'NSN', value: '6850-01-494-9650', cell: 'B49' },
			{ label: 'FSC', value: '8030', cell: 'E49' }
		]);
	});

	it('identifier conflict, demo (b): the NIIN, not the FSC', () => {
		const analysis = initial('b-identifier-conflict.xlsx');
		expect(text(explainDecision(decisionOf(analysis, 'resolve-identifier-conflict'), analysis))).toEqual({
			headline: "The NIIN doesn't match this NSN",
			body: "An NSN ends with its 9-digit NIIN. B2's NSN 5305-01-658-2565 ends with 016582565, but D2 says 016698021."
		});
	});

	it('identifier conflict keeps its explanation after a choice sets a cell aside', () => {
		const { model } = byName('b-identifier-conflict.xlsx');
		const first = initial('b-identifier-conflict.xlsx');
		const decision = decisionOf(first, 'resolve-identifier-conflict');
		for (const option of ['prefer-nsn', 'prefer-niin-fsc']) {
			const chosen = analyze(model, [], { decisions: { [decision.id]: option } });
			const again = chosen.decisions.find((candidate) => candidate.id === decision.id)!;
			expect(text(explainDecision(again, chosen)), option).toEqual(text(explainDecision(decision, first)));
		}
	});

	it('malformed NSN, WOW E134: the part number pasted into the NSN column', () => {
		const analysis = initial(wow.file);
		const record = singleRecordAt(analysis, 'Active Parts', 134);
		const explanation = explainDecision(decisionOf(analysis, 'import-valid-portion', record.id), analysis);
		expect(text(explanation)).toEqual({
			headline: 'E134 holds the part number, not an NSN',
			body: 'E134 holds 12663107, the same value as the part number in D134; an NSN has 13 digits.'
		});
		expect(explanation.facts).toEqual([
			{ label: 'NSN in the cell', value: '12663107', cell: 'E134' },
			{ label: 'Part number', value: '12663107', cell: 'D134' }
		]);
	});

	it('malformed NSN, WOW E166: a part-number-like value with a letter', () => {
		const analysis = initial(wow.file);
		const record = singleRecordAt(analysis, 'Active Parts', 166);
		expect(text(explainDecision(decisionOf(analysis, 'import-valid-portion', record.id), analysis))).toEqual({
			headline: 'The NSN in E166 contains letters',
			body: 'E166 holds 280-035-330-101F. An NSN is 13 digits, so this looks like a part number in the NSN column.'
		});
	});

	it('split cell, WOW D136: two part numbers on two lines', () => {
		const analysis = initial(wow.file);
		const [first] = recordAt(analysis, 'Active Parts', 136);
		expect(text(explainDecision(decisionOf(analysis, 'split-cell', first.id), analysis))).toEqual({
			headline: 'D136 lists 2 part numbers on separate lines',
			body: 'They are 12669555 and RVX08212; the other values in row 136 go with each one.'
		});
	});

	it("PENCOM's two cross-sheet conflicts name each sheet's description", () => {
		const analysis = initial(pencom.file);
		const conflicts = analysis.decisions.filter((decision) => decision.kind === 'resolve-conflict').map((decision) => text(explainDecision(decision, analysis)));
		expect(conflicts).toEqual([
			{
				headline: 'The two sheets disagree on the description',
				body: 'Both list this part number and NSN, but NSN Cross-Reference row 3 says "Screw, Machine" and Part Number Intake row 4 says "6-32 x 1/4 pan-head SEMS machine screw".'
			},
			{
				headline: 'The two sheets disagree on the description',
				body: 'Both list this part number and NSN, but NSN Cross-Reference row 4 says "Screw, Assembly" and Part Number Intake row 3 says "Assembly screw".'
			}
		]);
	});

	it('a conflict within one sheet names the cells', async () => {
		const model = await buildWorkbook('one-sheet-conflict.xlsx', [
			{ name: 'Parts', rows: [['Part Number', 'NSN', 'Description'], ['ABC-1', NSN[0], 'RIVET,BLIND'], ['ABC-1', NSN[0], 'DUCT (ENGINE OIL BREATHER)']] }
		]);
		const analysis = analyze(model, [], {});
		expect(text(explainDecision(decisionOf(analysis, 'resolve-conflict'), analysis))).toEqual({
			headline: 'Rows 2 and 3 disagree on the description',
			body: 'Both list this part number and NSN, but C2 says "RIVET,BLIND" and C3 says "DUCT (ENGINE OIL BREATHER)".'
		});
	});

	it('storage conflict, demo (c): the saved description against the new one', () => {
		const analysis = initial('c-pencom-changed-copy.xlsx');
		expect(text(explainDecision(decisionOf(analysis, 'resolve-storage-conflict'), analysis, SAVED_PENCOM))).toEqual({
			headline: 'Your saved record has a different description',
			body: 'This part number and NSN are already saved with the description "Screw, Machine", but C2 says "Screw, machine, pan head, SEMS".'
		});
	});

	it('dropped duplicates: a saved copy, and the same NSN twice in one cell', () => {
		// After "Accept all suggestions" the cross-reference records import, and each is a copy of a saved one.
		const again = byName('pencom-again').analyses[1];
		const saved = again.decisions.find((decision) => decision.kind === 'drop-duplicate' && decision.recordIds.length === 1)!;
		expect(text(explainDecision(saved, again, SAVED_PENCOM))).toEqual({
			headline: 'Already in your saved mappings',
			body: 'Part number 6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P with NSN 5305-01-658-2565 is already saved, and nothing in this row disagrees with the saved record.'
		});
		const substring = initial(SUBSTRING);
		const [, copy] = recordAt(substring, SUBSTRING_SHEET, 36);
		expect(text(explainDecision(decisionOf(substring, 'drop-duplicate', copy.id), substring))).toEqual({
			headline: 'B36 lists the same NSN twice',
			body: '6135-01-455-7947 appears twice in B36.'
		});
	});

	it('tables: a clear one, one that needs review, and one with a column found by its values', () => {
		const table = (name: string, sheet: string) => {
			const analysis = initial(name);
			return text(explainDecision(decisionOf(analysis, 'include-table', recordAt(analysis, sheet, tableOf(analysis, sheet).dataRows[0])[0].id), analysis));
		};
		expect(table(wow.file, 'Active Parts')).toEqual({
			headline: 'A table of 179 rows in A1:F180',
			body: 'It has part numbers in D, NSNs in E and descriptions in F.'
		});
		expect(table(pencom.file, 'Search Log')).toEqual({
			headline: 'Not sure column B holds part numbers',
			body: 'Its header, "Part Number / Family", only partly names part numbers, and only 67% of its values look like part numbers.'
		});
		expect(table(SHIFTED, sheetOf(initial(SHIFTED), initial(SHIFTED).sheets[0].name).name).body).toBe(
			'It has part numbers in A and NSNs in C. Its header, "Part Number", does not name NSNs, though all of its values are valid NSNs.'
		);
	});
});

describe('issue templates on real cases', () => {
	it('invalid values: a malformed NSN', () => {
		const analysis = initial(wow.file);
		expect(issueText(analysis, singleRecordAt(analysis, 'Active Parts', 166), 'invalid-identifier').headline).toBe('The NSN in E166 contains letters');

	});

	it('split from a multi-value cell, WOW D136', () => {
		const analysis = initial(wow.file);
		const [, second] = recordAt(analysis, 'Active Parts', 136);
		expect(issueText(analysis, second, 'split-from-multi-value')).toEqual({
			headline: 'Second of 2 part numbers in D136',
			body: 'D136 lists 2 part numbers on separate lines, and each gets its own record; this one is RVX08212.'
		});
		expect(recordLabel(second)).toBe('row 136, second of 2 part numbers in D136');
		expect(recordLabel(second, { sheet: true })).toBe('Active Parts row 136, second of 2 part numbers in D136');
	});

	it('the same item under two FSCs, Statz row 20', () => {
		const analysis = initial(statz.file);
		expect(issueText(analysis, singleRecordAt(analysis, 'Sheet1', 20), 'fsc-niin-mismatch')).toEqual({
			headline: 'This item is listed under 2 different FSCs',
			body: 'NIIN 003007957 has FSC 3510 here, but 5210 in row 22. An item has one FSC at a time, so one of these NSNs is probably out of date or mistyped.'
		});
	});

	it('cross-sheet conflict from each side, PENCOM', () => {
		const analysis = initial(pencom.file);
		expect(issueText(analysis, singleRecordAt(analysis, 'Part Number Intake', 3), 'conflict')).toEqual({
			headline: 'Another sheet has a different description',
			body: 'Both list part number SE5826 with NSN 5305-01-669-8021, but this row says "Assembly screw" and NSN Cross-Reference row 4 says "Screw, Assembly".'
		});
	});

	it('identifier conflict on one record, Substring row 49', () => {
		const analysis = initial(SUBSTRING);
		const [record] = recordAt(analysis, SUBSTRING_SHEET, 49);
		expect(issueText(analysis, record, 'conflict').headline).toBe("The FSC doesn't match this NSN");
	});

	it('duplicates: a repeat inside one cell, and a saved copy', () => {
		const substring = initial(SUBSTRING);
		const [, copy] = recordAt(substring, SUBSTRING_SHEET, 36);
		expect(issueText(substring, copy, 'duplicate-in-table')).toEqual({
			headline: 'B36 lists the same NSN twice',
			body: 'This is the same NSN as the first one, 6135-01-455-7947.'
		});
		const again = byName('pencom-again').analyses[1];
		const savedCopy = again.records.find((record) => record.issues.some((issue) => issue.code === 'duplicate-in-storage'))!;
		expect(issueText(again, savedCopy, 'duplicate-in-storage', SAVED_PENCOM).headline).toBe('Already in your saved mappings');
		const changed = initial('c-pencom-changed-copy.xlsx');
		const screw = changed.records.find((record) => record.issues.some((issue) => issue.code === 'duplicate-in-storage' && issue.field))!;
		expect(issueText(changed, screw, 'duplicate-in-storage', SAVED_PENCOM)).toEqual({
			headline: 'Your saved record has a different description',
			body: 'Part number 6-32X1/4PH-PN-SQCN-SEMS-MS-SS-P with NSN 5305-01-658-2565 is already saved with the description "Screw, Machine", but C2 says "Screw, machine, pan head, SEMS".'
		});
	});

	it('uncertain columns, PENCOM Search Log and ShiftedTable', () => {
		const analysis = initial(pencom.file);
		const issues = singleRecordAt(analysis, 'Search Log', 4).issues.filter((issue) => issue.code === 'low-confidence-mapping');
		expect(issues.map((issue) => text(explainIssue(issue, singleRecordAt(analysis, 'Search Log', 4), analysis)))).toEqual([
			{
				headline: 'Not sure column B holds part numbers',
				body: 'Its header, "Part Number / Family", only partly names part numbers, and only 67% of its values look like part numbers.'
			},
			{
				headline: 'Not sure column F holds NSNs',
				body: 'Its header, "NSN / Reference", names NSNs, but only 67% of its values are valid NSNs.'
			}
		]);
	});

	it('values worth a look: a note in brackets, text in a part column, a missing description', () => {
		const analysis = initial(wow.file);
		expect(issueText(analysis, singleRecordAt(analysis, 'Active Parts', 43), 'suspicious-value')).toEqual({
			headline: 'Part number has a note in brackets',
			body: '"12273108 (EATON M144E)" in D43 includes text in brackets; it is kept exactly as written.'
		});
		expect(issueText(analysis, singleRecordAt(analysis, 'Active Parts', 180), 'missing-optional')).toEqual({
			headline: 'No description in this row',
			body: 'F180 is empty; a description is optional.'
		});
		const log = initial(pencom.file);
		expect(issueText(log, singleRecordAt(log, 'Search Log', 3), 'suspicious-value')).toEqual({
			headline: "This doesn't look like a part number",
			body: 'B3 holds "PENCOM CAGE", which has no digits.'
		});
	});
});

describe('kinds and codes the supplied workbooks do not produce', () => {
	it('two multi-value identifiers in one row: ambiguous, with even and uneven counts', async () => {
		const model = await buildWorkbook('ambiguous.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NSN', 'Description'],
					['ABC-1\nABC-2', `${NSN[0]}\n${NSN[1]}`, 'Bolt'],
					['XYZ-1\nXYZ-2', `${NSN[2]}\n${NSN[3]}\n${NSN[4]}`, 'Nut']
				]
			}
		]);
		const analysis = analyze(model, [], {});
		const [even, uneven] = analysis.decisions.filter((decision) => decision.kind === 'ambiguous-multi-value').map((decision) => text(explainDecision(decision, analysis)));
		expect(even).toEqual({
			headline: 'Not clear which values go together',
			body: 'A2 lists 2 part numbers and B2 lists 2 NSNs on separate lines, so it is not clear which part number goes with which NSN.'
		});
		expect(uneven.body).toBe(
			'A3 lists 2 part numbers and B3 lists 3 NSNs on separate lines, so it is not clear which part number goes with which NSN. The counts differ, so they cannot be lined up in order.'
		);
		const kept = singleRecordAt(analysis, 'Parts', 3);
		expect(issueText(analysis, kept, 'ambiguous-multi-value').headline).toBe('Not clear which values go together');
		expect(issueText(analysis, kept, 'invalid-identifier')).toEqual({
			headline: 'B3 lists 3 NSNs on separate lines',
			body: 'Read as one value, the cell is not a valid NSN.'
		});
	});

	it('the same item on two sheets with compatible values: merged', async () => {
		const model = await buildWorkbook('merge.xlsx', [
			{ name: 'Parts', rows: [['Part Number', 'NSN', 'Description', 'CAGE'], ['ABC-1', NSN[0], 'Bolt', null]] },
			{ name: 'Intake', rows: [['Part Number', 'NSN', 'Description', 'CAGE'], ['ABC-1', NSN[0], null, '0BWZ1']] }
		]);
		const analysis = analyze(model, [], {});
		expect(text(explainDecision(decisionOf(analysis, 'merge-duplicates'), analysis))).toEqual({
			headline: 'The same item is listed twice',
			body: 'Parts row 2 and Intake row 2 both list part number ABC-1 with NSN 5305-01-658-2565, and their other values agree or are blank in one of them.'
		});
		expect(issueText(analysis, singleRecordAt(analysis, 'Intake', 2), 'duplicate-across-sheets')).toEqual({
			headline: 'Same item as Parts row 2',
			body: 'Parts row 2 also lists part number ABC-1 with NSN 5305-01-658-2565, and the other values agree or are blank in one of them.'
		});
	});

	it('numbers Excel stripped of leading zeros, and two values wrong in one row', async () => {
		const model = await buildWorkbook('numbers.xlsx', [
			{
				name: 'Parts',
				rows: [
					['Part Number', 'NIIN', 'CAGE', 'Description'],
					['P-1', 16582565, 1234, 'Bolt'],
					['P-2', '016698021', '0BWZ1', 'Nut'],
					['P-3', '5305-01-658-2565', 'AB', 'Pin'],
					[null, null, null, 'Washer']
				]
			}
		]);
		const analysis = analyze(model, [], {});
		const record = singleRecordAt(analysis, 'Parts', 2);
		const [niin, cage] = record.issues.filter((issue) => issue.code === 'suspicious-value').map((issue) => text(explainIssue(issue, record, analysis)));
		expect(niin).toEqual({
			headline: 'Leading zeros added back to the NIIN',
			body: 'Excel stored B2 as the number 16582565, which drops leading zeros; the NIIN reads 016582565.'
		});
		expect(cage.body).toBe('Excel stored C2 as the number 1234, which drops leading zeros; the CAGE code reads 01234.');
		const both = singleRecordAt(analysis, 'Parts', 4);
		expect(text(explainDecision(decisionOf(analysis, 'import-valid-portion', both.id), analysis))).toEqual({
			headline: 'Row 4 has 2 values that are not valid',
			body: 'The NIIN in B4 (5305-01-658-2565) and the CAGE code in C4 ("AB") are not valid.'
		});
		expect(issueText(analysis, singleRecordAt(analysis, 'Parts', 5), 'missing-primary-identifier')).toEqual({
			headline: 'No part number, NSN, or NIIN in this row',
			body: 'A record needs a part number, NSN, or NIIN, and the part number cell A5 and the NIIN cell B5 are empty.'
		});
	});

	it('two columns that both fit the part number', async () => {
		const model = await buildWorkbook('compete.xlsx', [
			{
				name: 'Parts',
				rows: [['Part Number', 'NSN', 'P/N'], ['ABC-1', NSN[0], 'ABC-9'], ['ABC-2', NSN[1], 'ABC-8'], ['ABC-3', NSN[2], 'ABC-7']]
			}
		]);
		const analysis = analyze(model, [], {});
		expect(text(explainDecision(decisionOf(analysis, 'include-table'), analysis))).toEqual({
			headline: 'Columns A and C both look like part numbers',
			body: 'Their values all fit, so it is not clear which column holds the part numbers.'
		});
	});
});

describe('sheets and columns', () => {
	const sheetModel = (name: string, sheet: string) => byName(name).model.sheets.find((candidate) => candidate.name === sheet);

	it('says why a sheet has no table', () => {
		const just = initial(JUST_NSNS);
		expect(explainSheetWithoutTable(just.sheets[0], sheetModel(JUST_NSNS, just.sheets[0].name))).toEqual({
			headline: "No header row: we couldn't tell which column is which",
			lines: ['99 cells look like NSNs or NIINs, but no row above them names the columns.']
		});
		const analysis = initial(pencom.file);
		expect(explainSheetWithoutTable(sheetOf(analysis, 'Sources & Notes'), sheetModel(pencom.file, 'Sources & Notes'))).toEqual({
			headline: 'No column of part numbers, NSNs, or NIINs',
			lines: ['"Commercial NSN aggregator" mentions them, but the values below are something else.']
		});
		expect(explainSheetWithoutTable(sheetOf(analysis, 'Opportunity Matrix'), sheetModel(pencom.file, 'Opportunity Matrix'))).toEqual({
			headline: 'No column of part numbers, NSNs, or NIINs',
			lines: ['"NSN Matchability (1-5)" mentions them, but the values below are something else.']
		});
		const wowAnalysis = initial(wow.file);
		expect(explainSheetWithoutTable(sheetOf(wowAnalysis, 'hiddenSheet'), sheetModel(wow.file, 'hiddenSheet')).headline).toBe('Hidden in Excel');
	});

	it('notes rows left out of a table and rows below it', () => {
		const analysis = initial(statz.file);
		expect(tableNotes(tableOf(analysis, 'Sheet1'), sheetModel(statz.file, 'Sheet1'))).toEqual([
			'Rows 32-33 are blank and row 34 repeats the header, so they are left out.',
			'There is no description or CAGE code column.'
		]);
		const shifted = initial(SHIFTED);
		const sheet = shifted.sheets[0].name;
		expect(tableNotes(tableOf(shifted, sheet), sheetModel(SHIFTED, sheet))).toContain('Rows 34-58 below the table are not part of it and not imported.');
	});

	it("explains each column from its header and values, with the structure stage's counts", () => {
		const analysis = initial(wow.file);
		const table = tableOf(analysis, 'Active Parts');
		const sheet = sheetModel(wow.file, 'Active Parts');
		const column = (col: number) => explainColumn(table.columns.find((candidate) => candidate.col === col)!, table, sheet);
		expect(column(5)).toEqual({ summary: '127 of 129 values are valid NSNs.', lines: ['The header "NSN" names NSNs.', '127 of 129 values are valid NSNs.'] });
		expect(column(1).summary).toBe('Hidden in Excel, so it is not imported.');
		const statzTable = tableOf(initial(statz.file), 'Sheet1');
		expect(explainColumn(statzTable.columns[1], statzTable, sheetModel(statz.file, 'Sheet1')).summary).toBe(
			"16 of 16 values look like part numbers, but the header doesn't say so."
		);
		const log = tableOf(initial(pencom.file), 'Search Log');
		expect(explainColumn(log.columns[1], log, sheetModel(pencom.file, 'Search Log')).lines).toEqual([
			`The header "Part Number / Family" mentions part numbers, but it also says 'family'.`,
			'2 of 3 values look like part numbers.'
		]);
	});

	it('follows the copy rules in every sheet and column line', () => {
		const broken: string[] = [];
		for (const { name, model, analyses } of loaded) {
			const analysis = analyses[0];
			for (const sheet of analysis.sheets) {
				const source = model.sheets.find((candidate) => candidate.name === sheet.name);
				const lines =
					sheet.tables.length === 0
						? (({ headline, lines }) => [headline, ...lines])(explainSheetWithoutTable(sheet, source))
						: sheet.tables.flatMap((table) => [
								...tableNotes(table, source),
								...table.columns.flatMap((column) => explainColumn(column, table, source).lines)
							]);
				for (const line of lines) {
					const problems = copyProblems(line, []);
					if (problems.length) broken.push(`${name} ${sheet.name}: ${line} (${problems.join(', ')})`);
				}
			}
		}
		expect(broken).toEqual([]);
	});
});
