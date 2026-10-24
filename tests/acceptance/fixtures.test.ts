/**
 * Golden tests: the three real workbooks through readWorkbook() -> analyze(model, [], {}), checked against
 * tests/fixtures/expectations.ts. The first block applies the shared expectations to every fixture; the
 * per-fixture blocks cover the cases PLAN.md calls out by cell.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { analyze } from '../../src/lib/import/analyze';
import {
	decisionId,
	type StoredMapping,
	type WorkbookAnalysis,
	type WorkbookModel
} from '../../src/lib/import/model';
import { qualifiedRef } from '../../src/lib/import/refs';
import { toImportPlan } from '../../src/lib/import/validate';
import { FIXTURES, pencom, statz, wow } from '../fixtures/expectations';
import {
	acceptAllSuggestions,
	byPart,
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

describe('fixture acceptance', () => {
	for (const fixture of FIXTURES) {
		describe(fixture.file, () => {
			let model: WorkbookModel;
			let analysis: WorkbookAnalysis;
			let accepted: WorkbookAnalysis;

			beforeAll(async () => {
				model = await loadFixture(fixture.file);
				analysis = analyze(model, [], {});
				accepted = analyze(model, [], acceptAllSuggestions(analysis));
			});

			it('classifies every sheet in workbook order', () => {
				expect(analysis.sheets.map(({ name, status }) => ({ name, status }))).toEqual(
					fixture.sheets.map(({ name, status }) => ({ name, status }))
				);
				for (const sheet of analysis.sheets) {
					if (sheet.status === 'hidden' || sheet.status === 'no-table') {
						expect(sheet.tables, sheet.name).toEqual([]);
					}
					expect(sheet.reasons.length, `reasons for ${sheet.name}`).toBeGreaterThan(0);
				}
			});

			for (const sheet of fixture.sheets) {
				const expected = sheet.table;
				if (!expected) continue;

				it(`${sheet.name}: header, mapping, and rows`, () => {
					const table = tableOf(analysis, sheet.name);
					expect(table.id).toBe(`${sheet.name}@${expected.headerRows[0]}`);
					expect(table.status).toBe(sheet.status);
					expect(table.headerRows).toEqual(expected.headerRows);
					if (expected.mapping) expect(mappedColumns(table)).toEqual(expected.mapping);
					if (expected.dataRows) expect(table.dataRows).toEqual(expected.dataRows);
					if (expected.skippedRows) {
						expect([...table.skippedRows].sort((a, b) => a.row - b.row)).toEqual(expected.skippedRows);
					}
					if (expected.dataRows && expected.skippedRows) {
						const lastRow = Math.max(...expected.dataRows, ...expected.skippedRows.map(({ row }) => row));
						expect(table.range).toMatchObject({ top: expected.headerRows[0], bottom: lastRow });
					}
					if (expected.records !== undefined) {
						expect(analysis.records.filter((record) => record.tableId === table.id)).toHaveLength(
							expected.records
						);
					}
					for (const field of expected.absentOptional ?? []) {
						expect(table.reasons.join('\n'), `table-level reason for missing ${field}`).toMatch(
							new RegExp(field, 'i')
						);
					}
				});
			}

			it('summarizes the analysis before any decision', () => {
				expect(analysis.summary).toMatchObject(fixture.initial);
				expectSummaryConsistent(analysis);
			});

			it('resolves everything with "Accept all suggestions"', () => {
				expect(accepted.summary).toMatchObject(fixture.afterAcceptAll);
				expectSummaryConsistent(accepted);
				expect(toImportPlan(accepted).add).toHaveLength(accepted.summary.toImport);
			});

			it('builds no records from hidden or no-table sheets', () => {
				const withTables = new Set(fixture.sheets.filter((sheet) => sheet.table).map((sheet) => sheet.name));
				expect(analysis.records.filter((record) => !withTables.has(record.sheet))).toEqual([]);
			});

			it('traces every value to the cell that holds it', () => {
				expectTraceable(model, analysis);
				expectTraceable(model, accepted);
			});

			it('never warns per row about an optional column that does not exist', () => {
				for (const record of analysis.records) {
					const mapped = new Set(tableOf(analysis, record.sheet).columns.map((column) => column.field));
					const missing = record.issues.filter((issue) => issue.code === 'missing-optional');
					for (const issue of missing) expect(mapped, `${record.id} ${issue.field}`).toContain(issue.field);
				}
			});
		});
	}

	describe(wow.file, () => {
		const SHEET = 'Active Parts';
		const TABLE = `${SHEET}@1`;
		let model: WorkbookModel;
		let analysis: WorkbookAnalysis;

		beforeAll(async () => {
			model = await loadFixture(wow.file);
			analysis = analyze(model, [], {});
		});

		it(`finds ${wow.nsn.valid} valid NSNs in ${wow.nsn.nonEmpty} non-empty NSN cells`, () => {
			const column = tableOf(analysis, SHEET).columns.find((candidate) => candidate.field === 'nsn');
			expect(column?.valuePassRate).toBeCloseTo(wow.nsn.valid / wow.nsn.nonEmpty, 6);

			const records = recordsOf(analysis, SHEET);
			const nsns = records.flatMap((record) => (record.fields.nsn ? [record.fields.nsn] : []));
			expect(nsns).toHaveLength(wow.nsn.valid);
			for (const { value, provenance } of nsns) {
				expect(value).toMatch(/^\d{13}$/);
				expect(value).toBe(provenance.original.replace(/-/g, ''));
				expect(provenance.cell).toBe(`${wow.nsn.column}${provenance.row}`);
			}
			const rejectedRows = records.filter((record) => record.rejected.nsn).map((record) => record.sourceRow);
			expect(rejectedRows).toEqual(wow.nsn.malformed.map(({ row }) => row));
		});

		for (const malformed of wow.nsn.malformed) {
			it(`reports E${malformed.row} as a malformed NSN and imports the valid portion`, () => {
				const record = singleRecordAt(analysis, SHEET, malformed.row);
				const cell = `${wow.nsn.column}${malformed.row}`;
				expect(record.fields.nsn).toBeUndefined();
				expect(record.rejected.nsn?.original).toBe(malformed.original);
				expect(record.rejected.nsn?.cell).toBe(cell);
				expect(record.fields.part?.value).toBeTruthy();
				expect(record).toMatchObject({ status: 'warning', approved: true });

				const issue = record.issues.find((candidate) => candidate.code === 'invalid-identifier');
				expect(issue).toMatchObject({ field: 'nsn' });
				expect(issue?.cells).toContain(qualifiedRef(SHEET, cell));
				if (malformed.sameAsPartIn) expect(issue?.message).toContain(malformed.sameAsPartIn);

				const decision = analysis.decisions.find(
					(candidate) => candidate.id === decisionId('import-valid-portion', `${TABLE}:r${malformed.row}`)
				);
				expect(decision).toMatchObject({ kind: 'import-valid-portion', state: 'auto', chosen: 'import-valid-portion' });
			});
		}

		it(`splits ${wow.split.cell} into one record per part number`, () => {
			const { row, cell, parts, description } = wow.split;
			const records = recordAt(analysis, SHEET, row);
			expect(records.map((record) => record.id)).toEqual(parts.map((_, i) => `${TABLE}:r${row}.${i + 1}`));
			records.forEach((record, i) => {
				expect(record.split).toEqual({ cell, index: i + 1, total: parts.length });
				expect(record.fields.part?.value).toBe(parts[i]);
				expect(record.fields.part?.provenance).toMatchObject({ cell, original: parts.join('\n') });
				expect(record.fields.part?.provenance.transforms).toContain('split-multi-value');
				expect(record.fields.description?.value).toBe(description);
				expect(record.issues.map((issue) => issue.code)).toContain('split-from-multi-value');
				expect(record.approved).toBe(true);
			});

			const decision = analysis.decisions.find(
				(candidate) => candidate.id === decisionId('split-cell', `${TABLE}:r${row}`)
			);
			expect(decision).toMatchObject({ kind: 'split-cell', state: 'auto', chosen: 'split' });
			expect([...(decision?.recordIds ?? [])].sort()).toEqual(records.map((record) => record.id).sort());
		});

		it(`keeps ${wow.split.cell} as one record when the user undoes the split`, () => {
			const { row, parts } = wow.split;
			const kept = analyze(model, [], {
				decisions: { [decisionId('split-cell', `${TABLE}:r${row}`)]: 'keep-as-one' }
			});
			const record = singleRecordAt(kept, SHEET, row);
			expect(record.split).toBeUndefined();
			expect(record.fields.part?.value).toBe(parts.join('\n'));
			expect(kept.summary.candidates).toBe(wow.initial.candidates - (parts.length - 1));
			expect(kept.decisions.find((d) => d.kind === 'split-cell')).toMatchObject({ state: 'user', chosen: 'keep-as-one' });
		});

		it('derives a labeled NIIN from every valid NSN', () => {
			for (const record of recordsOf(analysis, SHEET)) {
				const { nsn, niin } = record.fields;
				if (!nsn) {
					expect(niin, record.id).toBeUndefined();
					continue;
				}
				expect(niin?.value, record.id).toBe(nsn.value.slice(4));
				expect(niin?.provenance.origin, record.id).toBe('derived');
				expect(niin?.provenance.transforms, record.id).toContain('derive-niin-from-nsn');
				expect(niin?.provenance.derivedFrom, record.id).toContain(nsn.provenance.cell);
			}
		});

		it('warns about a missing description only where the Nomenclature cell is empty', () => {
			const warned = recordsOf(analysis, SHEET).filter((record) =>
				record.issues.some((issue) => issue.code === 'missing-optional' && issue.field === 'description')
			);
			expect(warned.map((record) => record.sourceRow)).toEqual(wow.missingDescriptionRows);
			for (const record of warned) expect(record.fields.description).toBeUndefined();
		});

		it('keeps part numbers exactly as written apart from trimming', () => {
			for (const record of recordsOf(analysis, SHEET)) {
				const part = record.fields.part;
				expect(part, record.id).toBeDefined();
				if (part && !record.split) expect(part.value, record.id).toBe(part.provenance.original.trim());
			}
			const annotated = singleRecordAt(analysis, SHEET, wow.annotatedPart.row);
			expect(annotated.fields.part?.value).toBe(wow.annotatedPart.value);
			expect(annotated.issues).toContainEqual(expect.objectContaining({ code: 'suspicious-value', field: 'part' }));
			expect(annotated.approved).toBe(true);
		});

		it('approves every candidate record', () => {
			expect(analysis.records.filter((record) => !record.approved).map((record) => record.id)).toEqual([]);
		});
	});

	describe(statz.file, () => {
		const SHEET = 'Sheet1';
		let analysis: WorkbookAnalysis;

		beforeAll(async () => {
			analysis = analyze(await loadFixture(statz.file), [], {});
		});

		it('offers Dwg Number as an alternative part column without mapping it', () => {
			const column = tableOf(analysis, SHEET).columns.find(
				(candidate) => candidate.col === colOf(statz.competingPartColumn)
			);
			expect(column).toMatchObject({ field: null });
			expect(column?.alternatives).toContain('part');
		});

		it('normalizes all 54 hyphenated NSNs to 13 digits', () => {
			const records = recordsOf(analysis, SHEET);
			expect(records).toHaveLength(54);
			for (const record of records) {
				const nsn = record.fields.nsn;
				expect(nsn?.value, record.id).toMatch(/^\d{13}$/);
				expect(nsn?.value, record.id).toBe(nsn?.provenance.original.replace(/-/g, ''));
				expect(nsn?.provenance.transforms, record.id).toContain('strip-separators');
			}
		});

		it('flags every record that shares a NIIN under another FSC, and imports them all', () => {
			const flagged = recordsOf(analysis, SHEET).filter((record) =>
				record.issues.some((issue) => issue.code === 'fsc-niin-mismatch')
			);
			expect(flagged.map((record) => record.sourceRow).sort((a, b) => a - b)).toEqual(
				statz.fscNiinMismatchGroups.flat()
			);
			for (const group of statz.fscNiinMismatchGroups) {
				const ids = group.map((row) => singleRecordAt(analysis, SHEET, row).id);
				for (const row of group) {
					const record = singleRecordAt(analysis, SHEET, row);
					const issue = record.issues.find((candidate) => candidate.code === 'fsc-niin-mismatch');
					expect(issue?.severity, record.id).toBe('warning');
					expect(issue?.relatedRecords, record.id).toEqual(
						expect.arrayContaining(ids.filter((id) => id !== record.id))
					);
					expect(record.approved, record.id).toBe(true);
				}
			}
		});

		it(`retains all NSNs of the ${statz.partsWithSeveralNsns} parts that map to several`, () => {
			const nsnsByPart = new Map<string, Set<string>>();
			for (const record of recordsOf(analysis, SHEET)) {
				const part = record.fields.part?.value ?? '';
				nsnsByPart.set(part, (nsnsByPart.get(part) ?? new Set()).add(record.fields.nsn?.value ?? ''));
				expect(record.approved, record.id).toBe(true);
			}
			expect([...nsnsByPart.values()].filter((nsns) => nsns.size > 1)).toHaveLength(statz.partsWithSeveralNsns);
		});

		it('adds no per-row warning for the missing Description and CAGE columns', () => {
			const warnings = recordsOf(analysis, SHEET).flatMap((record) =>
				record.issues.filter((issue) => issue.code === 'missing-optional')
			);
			expect(warnings).toEqual([]);
		});
	});

	describe(pencom.file, () => {
		let analysis: WorkbookAnalysis;
		let accepted: WorkbookAnalysis;
		const idOf = ({ sheet, row }: { sheet: string; row: number }) =>
			singleRecordAt(analysis, sheet, row).id;

		beforeAll(async () => {
			const model = await loadFixture(pencom.file);
			analysis = analyze(model, [], {});
			accepted = analyze(model, [], acceptAllSuggestions(analysis));
		});

		it(`holds ${pencom.heldBackSheet} back with "exclude" suggested`, () => {
			const table = tableOf(analysis, pencom.heldBackSheet);
			const decision = analysis.decisions.find((candidate) => candidate.id === decisionId('include-table', table.id));
			expect(decision).toMatchObject({ kind: 'include-table', state: 'pending', chosen: null, suggested: 'exclude' });
			expect(recordsOf(analysis, pencom.heldBackSheet).filter((record) => record.approved)).toEqual([]);

			for (const sheet of pencom.sheets.filter((candidate) => candidate.status === 'ready')) {
				const id = decisionId('include-table', tableOf(analysis, sheet.name).id);
				expect(analysis.decisions.find((candidate) => candidate.id === id)).toMatchObject({
					state: 'auto',
					chosen: 'include'
				});
			}
		});

		it('holds back the overlapping XRef and Intake records as 2 pending conflicts', () => {
			const conflicts = analysis.decisions.filter((decision) => decision.kind === 'resolve-conflict');
			expect(conflicts).toHaveLength(pencom.conflicts.length);

			for (const { preferred, other } of pencom.conflicts) {
				const ids = [idOf(preferred), idOf(other)].sort();
				const decision = conflicts.find((candidate) => candidate.id === decisionId('resolve-conflict', ids.join('+')));
				expect(decision, ids.join(' vs ')).toMatchObject({
					state: 'pending',
					chosen: null,
					suggested: `prefer:${idOf(preferred)}`
				});
				expect([...(decision?.recordIds ?? [])].sort()).toEqual(ids);
				expect(decision?.cells).toEqual(
					expect.arrayContaining([
						qualifiedRef(preferred.sheet, preferred.descriptionCell),
						qualifiedRef(other.sheet, other.descriptionCell)
					])
				);
				for (const side of [preferred, other]) {
					const record = singleRecordAt(analysis, side.sheet, side.row);
					expect(record).toMatchObject({ status: 'conflict', approved: false });
					expect(record.issues.map((issue) => issue.code)).toContain('conflict');
				}
			}
		});

		it('imports nothing until the conflicts are resolved', () => {
			expect(toImportPlan(analysis)).toEqual({ add: [], replace: [] });
		});

		it('imports the 2 XRef records after "Accept all suggestions"', () => {
			const approved = accepted.records.filter((record) => record.approved);
			expect(approved.map((record) => record.id).sort()).toEqual(
				pencom.conflicts.map(({ preferred }) => idOf(preferred)).sort()
			);
			for (const record of approved) {
				expect(record.fields.cage?.provenance).toMatchObject({ sheet: record.sheet, row: record.sourceRow });
			}
			expect(toImportPlan(accepted).add.sort(byPart)).toEqual([...pencom.imported].sort(byPart));
		});
	});

	describe(`${pencom.file} with a saved copy whose description differs`, () => {
		// pencom.imported lists the merged XRef screw first, then SE5826.
		const [screw, assembly] = pencom.imported;
		const saved: StoredMapping = { ...screw, id: 'saved-screw', description: 'Machine screw, pan head SEMS' };
		let model: WorkbookModel;
		let settled: Record<string, string>;
		let recordId: string;
		let storageId: string;

		const analyzeWith = (choice?: string): WorkbookAnalysis =>
			analyze(model, [saved], { decisions: { ...settled, ...(choice ? { [storageId]: choice } : {}) } });

		beforeAll(async () => {
			model = await loadFixture(pencom.file);
			const initial = analyze(model, [saved], {});
			// Settle the cross-sheet conflicts and Search Log as "Accept all suggestions" would, but leave the storage
			// decision open: the XRef record only reaches the storage check once no cross-sheet conflict holds it.
			settled = Object.fromEntries(
				initial.decisions
					.filter((decision) => decision.state === 'pending' && decision.kind !== 'resolve-storage-conflict')
					.map((decision) => [decision.id, decision.suggested])
			);
			const xref = recordsOf(initial, pencom.conflicts[0].preferred.sheet);
			const record = xref.find((candidate) => candidate.fields.part?.value === screw.part);
			if (!record) throw new Error(`No XRef record for part ${screw.part}`);
			recordId = record.id;
			storageId = decisionId('resolve-storage-conflict', `${recordId}+saved:${saved.id}`);
		});

		it('holds the screw back as a pending storage conflict with "keep-saved" suggested', () => {
			const analysis = analyzeWith();
			const decision = analysis.decisions.find((candidate) => candidate.id === storageId);
			expect(decision).toMatchObject({
				kind: 'resolve-storage-conflict',
				state: 'pending',
				chosen: null,
				suggested: 'keep-saved',
				existingIds: [saved.id]
			});
			expect(decision?.recordIds).toContain(recordId);
			expect(decision?.options.map((option) => option.id)).toEqual(
				expect.arrayContaining(['keep-saved', 'replace-saved', 'keep-both'])
			);
			expect(decision?.reason).toMatch(/description/i);
			expect(analysis.records.find((record) => record.id === recordId)?.approved).toBe(false);
			expect(analysis.summary.pendingDecisions).toBe(1);
			expect(toImportPlan(analysis)).toEqual({ add: [assembly], replace: [] });
			expectSummaryConsistent(analysis);
			expectTraceable(model, analysis);
		});

		it.each([
			{ choice: 'keep-saved', approved: false, plan: { add: [assembly], replace: [] } },
			{ choice: 'replace-saved', approved: true, plan: { add: [assembly], replace: [{ id: saved.id, input: screw }] } },
			{ choice: 'keep-both', approved: true, plan: { add: [screw, assembly], replace: [] } }
		])('$choice -> the expected import plan', ({ choice, approved, plan }) => {
			const analysis = analyzeWith(choice);
			const record = analysis.records.find((candidate) => candidate.id === recordId);
			expect(analysis.decisions.find((candidate) => candidate.id === storageId)).toMatchObject({
				state: 'user',
				chosen: choice
			});
			expect(record?.approved).toBe(approved);
			if (choice === 'keep-saved') expect(record?.status).toBe('duplicate');
			const { add, replace } = toImportPlan(analysis);
			expect({ add: add.sort(byPart), replace }).toEqual({ add: [...plan.add].sort(byPart), replace: plan.replace });
			expect(analysis.summary.pendingDecisions).toBe(0);
			expectSummaryConsistent(analysis);
			expectTraceable(model, analysis);
		});
	});
});
