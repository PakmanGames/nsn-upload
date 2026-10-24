import { describe, expect, it } from 'vitest';
import type { Decision, DecisionKind, IssueCode, RecordStatus, SheetStatus } from '$lib/import/model';
import { buildMockAnalysis, mockAnalysis } from './mock-analysis';

// Records keyed by every union member, so adding one to the contract fails to compile until the mock covers it.
const SHEET_STATUSES = Object.keys({
	ready: 1,
	'needs-review': 1,
	'no-table': 1,
	hidden: 1
} satisfies Record<SheetStatus, 1>);
const RECORD_STATUSES = Object.keys({
	valid: 1,
	warning: 1,
	invalid: 1,
	duplicate: 1,
	conflict: 1,
	pending: 1
} satisfies Record<RecordStatus, 1>);
const ISSUE_CODES = Object.keys({
	'invalid-identifier': 1,
	'missing-primary-identifier': 1,
	'duplicate-in-table': 1,
	'duplicate-across-sheets': 1,
	'duplicate-in-storage': 1,
	conflict: 1,
	'ambiguous-multi-value': 1,
	'low-confidence-mapping': 1,
	'split-from-multi-value': 1,
	'fsc-niin-mismatch': 1,
	'suspicious-value': 1,
	'missing-optional': 1
} satisfies Record<IssueCode, 1>);
const DECISION_KINDS = Object.keys({
	'include-table': 1,
	'split-cell': 1,
	'ambiguous-multi-value': 1,
	'import-valid-portion': 1,
	'merge-duplicates': 1,
	'drop-duplicate': 1,
	'resolve-conflict': 1,
	'resolve-identifier-conflict': 1,
	'resolve-storage-conflict': 1
} satisfies Record<DecisionKind, 1>);
const DECISION_STATES = Object.keys({ auto: 1, pending: 1, user: 1 } satisfies Record<Decision['state'], 1>);

const distinct = <T>(values: T[]) => [...new Set(values)].sort();

describe('mockAnalysis', () => {
	it('covers every sheet status, record status, issue code, and decision kind and state', () => {
		expect(distinct(mockAnalysis.sheets.map((sheet) => sheet.status))).toEqual(SHEET_STATUSES.sort());
		expect(distinct(mockAnalysis.records.map((record) => record.status))).toEqual(RECORD_STATUSES.sort());
		expect(distinct(mockAnalysis.records.flatMap((record) => record.issues.map((issue) => issue.code)))).toEqual(
			ISSUE_CODES.sort()
		);
		expect(distinct(mockAnalysis.decisions.map((decision) => decision.kind))).toEqual(DECISION_KINDS.sort());
		expect(distinct(mockAnalysis.decisions.map((decision) => decision.state))).toEqual(DECISION_STATES.sort());
	});

	it('keeps ids unique and cell refs in the conventions the pipeline uses', () => {
		const ids = mockAnalysis.records.map((record) => record.id);
		expect(new Set(ids).size).toBe(ids.length);
		for (const record of mockAnalysis.records) {
			for (const value of Object.values(record.fields)) {
				expect(value.provenance.cell).toMatch(/^[A-Z]+\d+$/);
				for (const ref of value.provenance.derivedFrom ?? []) expect(ref).toMatch(/^[A-Z]+\d+$/);
			}
			for (const issue of record.issues) for (const cell of issue.cells) expect(cell).toContain('!');
		}
	});

	it('imports nothing held back by a pending decision until its suggestion is accepted', () => {
		const before = buildMockAnalysis();
		const pending = before.decisions.filter((decision) => decision.state === 'pending');
		const held = new Set(pending.flatMap((decision) => decision.recordIds));
		expect(before.records.filter((record) => held.has(record.id) && record.approved)).toEqual([]);

		const after = buildMockAnalysis({
			decisions: Object.fromEntries(pending.map((decision) => [decision.id, decision.suggested]))
		});
		expect(after.summary.pendingDecisions).toBe(0);
		expect(after.summary.toImport).toBeGreaterThan(before.summary.toImport);
	});
});
